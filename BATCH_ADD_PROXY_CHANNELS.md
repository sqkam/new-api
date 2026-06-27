# 批量复制渠道并指定不同 SOCKS5 代理（直接改数据库）

> 场景：同一个上游（如 opencode.ai）需要用多个不同的出口 IPv6 地址请求，绕过单 IP 限流。每个渠道复制自同一个模板渠道，只改 `setting.proxy` 字段，分别走不同的 SOCKS5 代理。

## 适用前提

- 已有一个配置完整的**模板渠道**（含 `base_url`、`models`、`model_mapping`、`header_override`、`key`、`setting` 等），记录其 `id`（下文用 `<TMPL_ID>` 表示，如 11）
- 每个出口 IPv6 地址必须**已经能在服务器上作为源 IP 出站**（已 `ip addr add` 到网卡且运营商允许；详见下方[运营商限制](#运营商限制重要)）
- socks5proxy 已在服务器上运行（监听 `:11080`，源码在 `/Users/sqkam/temp/socks5proxy`，systemd 服务 `socks5proxy.service`）

## 数据库结构要点

- 表 `channels`：`id` 是 `PRIMARY KEY` 但**不是 AUTOINCREMENT**，插入新渠道必须显式指定 id（从 `MAX(id)+1` 开始）
- `setting` 字段是 JSON 字符串，代理地址在其中的 `proxy` 键，对应 Go 结构 `dto.ChannelSettings.Proxy`（见 `dto/channel_settings.go`）。格式：`socks5://[<ipv6>]:11080`
- 表 `abilities`：每个渠道的每个 model 对应一条记录，字段 `group`/`model`/`channel_id`/`enabled`/`priority`/`weight`/`tag`。注意 `group` 是 SQL 保留字，SQL 里要用反引号 `` `group` ``
- `channel_info` 字段是 JSON（存为 blob 或 text），含 `is_multi_key`/`multi_key_mode` 等，直接从模板复制即可

## 操作步骤

### 1. 停 new-api 容器，避免数据库锁冲突

```bash
ssh root@hk.sqkam2.top 'cd /root/new-api-sqkam && docker compose stop new-api'
```

### 2. 备份数据库（必做）

```bash
ssh root@hk.sqkam2.top 'cp /root/new-api-sqkam/data/one-api.db /root/new-api-sqkam/data/one-api.db.bak.$(date +%s)'
```

### 3. 准备代理地址列表

确认要用的 IPv6 地址都能在服务器上作为源 IP 出站（关键！见下方[运营商限制](#运营商限制重要)）。例如只有 2 个可用地址：

```
2a12:ab80:4:3::d74b:97e2
2a12:ab80:4:3::19cb:2c54
```

### 4. 运行 Python 脚本插入渠道

在服务器上执行（把 `<TMPL_ID>` 改成模板渠道 id，`addresses` 改成你的地址列表）：

```python
import sqlite3, json, time

DB = "/root/new-api-sqkam/data/one-api.db"
TMPL_ID = 11                    # 模板渠道 id，按实际改
PROXY_PORT = 11080              # socks5proxy 端口
addresses = [                   # 能用的出口 IPv6 地址列表
    "2a12:ab80:4:3::d74b:97e2",
    "2a12:ab80:4:3::19cb:2c54",
]

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
c = conn.cursor()

tmpl = dict(c.execute("SELECT * FROM channels WHERE id=?", (TMPL_ID,)).fetchone())
tmpl_abilities = [dict(r) for r in c.execute("SELECT * FROM abilities WHERE channel_id=?", (TMPL_ID,))]
setting = json.loads(tmpl["setting"])
start_id = (c.execute("SELECT MAX(id) FROM channels").fetchone()[0] or 0) + 1
now = int(time.time())
cols = list(tmpl.keys())

for idx, addr in enumerate(addresses):
    cid = start_id + idx
    setting["proxy"] = f"socks5://[{addr}]:{PROXY_PORT}"
    vals = []
    for k in cols:
        if k == "id":              vals.append(cid)
        elif k == "name":          vals.append(f"{tmpl['name']}_v6_{idx+1}")
        elif k == "setting":       vals.append(json.dumps(setting, separators=(",",":")))
        elif k == "created_time":  vals.append(now)
        elif k == "used_quota":    vals.append(0)
        elif k == "test_time":     vals.append(0)
        elif k == "response_time": vals.append(0)
        elif k == "balance":       vals.append(0.0)
        elif k == "balance_updated_time": vals.append(0)
        else:                      vals.append(tmpl[k])
    placeholders = ",".join(["?"] * len(cols))
    colnames = ",".join(f"`{k}`" for k in cols)
    c.execute(f"INSERT INTO channels ({colnames}) VALUES ({placeholders})", vals)
    for ab in tmpl_abilities:
        c.execute(
            'INSERT INTO abilities (`group`, model, channel_id, enabled, priority, weight, tag) VALUES (?,?,?,?,?,?,?)',
            (ab["group"], ab["model"], cid, ab["enabled"], ab["priority"], ab["weight"], ab["tag"]),
        )
    print(f"inserted id={cid} proxy=socks5://[{addr}]:{PROXY_PORT}")

conn.commit()
print(f"done: {len(addresses)} channels, {len(addresses)*len(tmpl_abilities)} abilities")
conn.close()
```

### 5. 启动 new-api

```bash
ssh root@hk.sqkam2.top 'cd /root/new-api-sqkam && docker compose start new-api'
```

### 6. 验证

```bash
# 抽查渠道
ssh root@hk.sqkam2.top 'python3 -c "
import sqlite3,json
c=sqlite3.connect(\"/root/new-api-sqkam/data/one-api.db\"); c.row_factory=sqlite3.Row
for r in c.execute(\"SELECT id,name,setting FROM channels WHERE id>=? ORDER BY id\",(12,)):
    print(r[\"id\"], r[\"name\"], json.loads(r[\"setting\"]).get(\"proxy\"))
"'

# 验证每个代理实际出站源 IP 匹配
for addr in 2a12:ab80:4:3::d74b:97e2 2a12:ab80:4:3::19cb:2c54; do
  r=$(curl -s --max-time 12 --interface "$addr" --socks5-hostname "[$addr]:11080" https://api64.ipify.org)
  echo "$addr -> $r $([ "$r" = "$addr" ] && echo OK || echo FAIL)"
done
```

## 回滚

```bash
ssh root@hk.sqkam2.top 'cd /root/new-api-sqkam && docker compose stop new-api'
ssh root@hk.sqkam2.top 'cp /root/new-api-sqkam/data/one-api.db.bak.<timestamp> /root/new-api-sqkam/data/one-api.db'
ssh root@hk.sqkam2.top 'cd /root/new-api-sqkam && docker compose start new-api'
```

## 关键字段说明（对应源码）

| 数据库字段 | Go 结构 / 文件 | 说明 |
|-----------|----------------|------|
| `channels.setting` (JSON) | `dto.ChannelSettings` (`dto/channel_settings.go`) | `proxy` 键即 `ChannelSettings.Proxy`，格式 `socks5://[<ipv6>]:<port>` |
| `channels.base_url` | `model.Channel.BaseURL` | 上游地址，如 `https://opencode.ai/zen` |
| `channels.header_override` (JSON) | `model.Channel.HeaderOverride` | 请求头覆盖，从模板复制 |
| `channels.model_mapping` (JSON) | `model.Channel.ModelMapping` | 模型名映射，从模板复制 |
| `channels.channel_info` (JSON) | `model.ChannelInfo` | 多 key 模式等元信息，从模板复制 |
| `channels.id` | — | PRIMARY KEY，非自增，插入必须显式指定 |
| `abilities.*` | `model.Ability` | 每个 model 一条，`channel_id` 关联渠道 |

## 运营商限制（重要！）

**使用 /48 前缀内的任意地址作为出口源 IP 前，必须在服务器上实测验证是否被运营商过滤。** 不同运营商策略不同：

- 有的运营商开放整个 /48，前缀内任意地址都能作为出口源 IP（此时可挑任意地址用）
- 有的运营商做了源地址过滤（uRPF/反向路径校验），只允许分配给你的具体 IPv6 地址出站，自加的其他地址出站包会被网关丢弃

是否有限制取决于你的运营商，**不能假设、必须实测**。

**验证某地址能否作为出口源 IP 的方法：**

```bash
# 1. 先把地址加到网卡
ip addr add <测试地址>/48 dev ens3
sleep 2   # 等 DAD 完成

# 2. ping 外网，看回程包能否收到
ping -6 -c 2 -W 3 -I <测试地址> 2606:4700:4700::1111
# 0% loss = 该地址可用，运营商未过滤
# 100% loss = 该地址被运营商过滤，不能用

# 3. 若不确定是出站还是回程问题，用 tcpdump 抓包定位
#    能看到 echo request 发出但收不到 echo reply = 回程被丢弃（典型的 uRPF 限制）
timeout 6 tcpdump -i ens3 -n "icmp6 and host <测试地址>" &
ping -6 -c 2 -W 2 -I <测试地址> 2606:4700:4700::1111
wait
```

只有通过 ping 测试（0% loss）的地址才能放进上面的 `addresses` 列表。

- 如果实测整个 /48 都通 → 可任意挑选前缀内地址，用 socks5proxy 的 `extra_ips` 配置批量自动添加即可
- 如果只有运营商分配的几个地址通 → 只能用这几个地址；需要更多出口 IP 须联系运营商分配，或要求开放整个 /48 的源地址过滤

## 相关组件

- **socks5proxy**（源码 `/Users/sqkam/temp/socks5proxy`）：监听 `:11080`，根据客户端连进来的本地 IP（`conn.LocalAddr()`）作为出站源 IP。部署在 `hk.sqkam2.top`，以 systemd 服务 `socks5proxy.service` 运行，配置文件 `/root/socks5proxy_config.yaml`（可用 `extra_ips` 让其启动时自动 `ip addr add` IPv6 地址，但仅 IPv6，IPv4 不自动添加）
- **Docker IPv6 网络**：new-api 容器在 `new-api-sqkam_new-api-network` 网络上，已启用 IPv6（子网 `fd00:dead::/64`）+ 宿主机 NAT66，容器才能访问宿主机公网 v6 代理地址。配置见 `/root/new-api-sqkam/docker-compose.yml`、`/etc/sysctl.d/99-docker-ipv6.conf`、`docker-ipv6-nat.service`
