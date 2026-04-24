/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React from 'react';
import {
  Button,
  Dropdown,
  Space,
  SplitButtonGroup,
  Tag,
  AvatarGroup,
  Avatar,
  Tooltip,
  Progress,
  Popover,
  Typography,
  Input,
  Modal,
} from '@douyinfe/semi-ui';
import {
  timestamp2string,
  renderGroup,
  renderQuota,
  getModelCategories,
  showError,
} from '../../../helpers';
import {
  IconTreeTriangleDown,
  IconCopy,
  IconEyeOpened,
  IconEyeClosed,
} from '@douyinfe/semi-icons';

// progress color helper
const getProgressColor = (pct) => {
  if (pct === 100) return 'var(--semi-color-success)';
  if (pct <= 10) return 'var(--semi-color-danger)';
  if (pct <= 30) return 'var(--semi-color-warning)';
  return undefined;
};

// Render functions
function renderTimestamp(timestamp) {
  return <>{timestamp2string(timestamp)}</>;
}

// Render status column only (no usage)
const renderStatus = (text, record, t) => {
  const enabled = text === 1;

  let tagColor = 'black';
  let tagText = t('未知状态');
  if (enabled) {
    tagColor = 'green';
    tagText = t('已启用');
  } else if (text === 2) {
    tagColor = 'red';
    tagText = t('已禁用');
  } else if (text === 3) {
    tagColor = 'yellow';
    tagText = t('已过期');
  } else if (text === 4) {
    tagColor = 'grey';
    tagText = t('已耗尽');
  }

  return (
    <Tag color={tagColor} shape='circle' size='small'>
      {tagText}
    </Tag>
  );
};

// Render group column
const renderGroupColumn = (text, record, t, groupRatios = {}) => {
  if (text === 'auto') {
    return (
      <Tooltip
        content={t(
          '当前分组为 auto，会自动选择最优分组，当一个组不可用时自动降级到下一个组（熔断机制）',
        )}
        position='top'
      >
        <Tag color='white' shape='circle'>
          {t('智能熔断')}
          {record && record.cross_group_retry ? `(${t('跨分组')})` : ''}
        </Tag>
      </Tooltip>
    );
  }
  const ratio = groupRatios[text];
  return (
    <span className='flex items-center gap-1'>
      {renderGroup(text)}
      {ratio !== undefined && (
        <Tag size='small' color='green' shape='circle'>
          {ratio}x
        </Tag>
      )}
    </span>
  );
};

// Render token key column with show/hide and copy functionality
const renderTokenKey = (
  text,
  record,
  showKeys,
  resolvedTokenKeys,
  loadingTokenKeys,
  toggleTokenVisibility,
  copyTokenKey,
  copyTokenConnectionString,
  t,
) => {
  const revealed = !!showKeys[record.id];
  const loading = !!loadingTokenKeys[record.id];
  const keyValue =
    revealed && resolvedTokenKeys[record.id]
      ? resolvedTokenKeys[record.id]
      : record.key || '';
  const displayedKey = keyValue ? `sk-${keyValue}` : '';

  return (
    <div className='w-[200px]'>
      <Input
        readOnly
        value={displayedKey}
        size='small'
        suffix={
          <div className='flex items-center'>
            <Button
              theme='borderless'
              size='small'
              type='tertiary'
              icon={revealed ? <IconEyeClosed /> : <IconEyeOpened />}
              loading={loading}
              aria-label='toggle token visibility'
              onClick={async (e) => {
                e.stopPropagation();
                await toggleTokenVisibility(record);
              }}
            />
            <Dropdown
              trigger='click'
              position='bottomRight'
              clickToHide
              menu={[
                {
                  node: 'item',
                  name: t('复制密钥'),
                  onClick: () => copyTokenKey(record),
                },
                {
                  node: 'item',
                  name: t('复制连接信息'),
                  onClick: () => copyTokenConnectionString(record),
                },
              ]}
            >
              <Button
                theme='borderless'
                size='small'
                type='tertiary'
                icon={<IconCopy />}
                loading={loading}
                aria-label='copy token key'
                onClick={async (e) => {
                  e.stopPropagation();
                }}
              />
            </Dropdown>
          </div>
        }
      />
    </div>
  );
};

// Render model limits column
const renderModelLimits = (text, record, t) => {
  if (record.model_limits_enabled && text) {
    const models = text.split(',').filter(Boolean);
    const categories = getModelCategories(t);

    const vendorAvatars = [];
    const matchedModels = new Set();
    Object.entries(categories).forEach(([key, category]) => {
      if (key === 'all') return;
      if (!category.icon || !category.filter) return;
      const vendorModels = models.filter((m) =>
        category.filter({ model_name: m }),
      );
      if (vendorModels.length > 0) {
        vendorAvatars.push(
          <Tooltip
            key={key}
            content={vendorModels.join(', ')}
            position='top'
            showArrow
          >
            <Avatar
              size='extra-extra-small'
              alt={category.label}
              color='transparent'
            >
              {category.icon}
            </Avatar>
          </Tooltip>,
        );
        vendorModels.forEach((m) => matchedModels.add(m));
      }
    });

    const unmatchedModels = models.filter((m) => !matchedModels.has(m));
    if (unmatchedModels.length > 0) {
      vendorAvatars.push(
        <Tooltip
          key='unknown'
          content={unmatchedModels.join(', ')}
          position='top'
          showArrow
        >
          <Avatar size='extra-extra-small' alt='unknown'>
            {t('其他')}
          </Avatar>
        </Tooltip>,
      );
    }

    return <AvatarGroup size='extra-extra-small'>{vendorAvatars}</AvatarGroup>;
  } else {
    return (
      <Tag color='white' shape='circle'>
        {t('无限制')}
      </Tag>
    );
  }
};

// Render IP restrictions column
const renderAllowIps = (text, t) => {
  if (!text || text.trim() === '') {
    return (
      <Tag color='white' shape='circle'>
        {t('无限制')}
      </Tag>
    );
  }

  const ips = text
    .split('\n')
    .map((ip) => ip.trim())
    .filter(Boolean);

  const displayIps = ips.slice(0, 1);
  const extraCount = ips.length - displayIps.length;

  const ipTags = displayIps.map((ip, idx) => (
    <Tag key={idx} shape='circle'>
      {ip}
    </Tag>
  ));

  if (extraCount > 0) {
    ipTags.push(
      <Tooltip
        key='extra'
        content={ips.slice(1).join(', ')}
        position='top'
        showArrow
      >
        <Tag shape='circle'>{'+' + extraCount}</Tag>
      </Tooltip>,
    );
  }

  return <Space wrap>{ipTags}</Space>;
};

// Render separate quota usage column
const renderQuotaUsage = (text, record, t) => {
  const { Paragraph } = Typography;
  const used = parseInt(record.used_quota) || 0;
  const remain = parseInt(record.remain_quota) || 0;
  const total = used + remain;
  if (record.unlimited_quota) {
    const popoverContent = (
      <div className='text-xs p-2'>
        <Paragraph copyable={{ content: renderQuota(used) }}>
          {t('已用额度')}: {renderQuota(used)}
        </Paragraph>
      </div>
    );
    return (
      <Popover content={popoverContent} position='top'>
        <Tag color='white' shape='circle'>
          {t('无限额度')}
        </Tag>
      </Popover>
    );
  }
  const percent = total > 0 ? (remain / total) * 100 : 0;
  const popoverContent = (
    <div className='text-xs p-2'>
      <Paragraph copyable={{ content: renderQuota(used) }}>
        {t('已用额度')}: {renderQuota(used)}
      </Paragraph>
      <Paragraph copyable={{ content: renderQuota(remain) }}>
        {t('剩余额度')}: {renderQuota(remain)} ({percent.toFixed(0)}%)
      </Paragraph>
      <Paragraph copyable={{ content: renderQuota(total) }}>
        {t('总额度')}: {renderQuota(total)}
      </Paragraph>
    </div>
  );
  return (
    <Popover content={popoverContent} position='top'>
      <Tag color='white' shape='circle'>
        <div className='flex flex-col items-end'>
          <span className='text-xs leading-none'>{`${renderQuota(remain)} / ${renderQuota(total)}`}</span>
          <Progress
            percent={percent}
            stroke={getProgressColor(percent)}
            aria-label='quota usage'
            format={() => `${percent.toFixed(0)}%`}
            style={{ width: '100%', marginTop: '1px', marginBottom: 0 }}
          />
        </div>
      </Tag>
    </Popover>
  );
};

// Render operations column
const renderOperations = (
  text,
  record,
  onOpenLink,
  setEditingToken,
  setShowEdit,
  manageToken,
  refresh,
  resetUsedCount,
  t,
) => {
  let chatsArray = [];
  try {
    const raw = localStorage.getItem('chats');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        const name = Object.keys(item)[0];
        if (!name) continue;
        chatsArray.push({
          node: 'item',
          key: i,
          name,
          value: item[name],
          onClick: () => onOpenLink(name, item[name], record),
        });
      }
    }
  } catch (_) {
    showError(t('聊天链接配置错误，请联系管理员'));
  }

  return (
    <Space wrap>
      <SplitButtonGroup
        className='overflow-hidden'
        aria-label={t('项目操作按钮组')}
      >
        <Button
          size='small'
          type='tertiary'
          onClick={() => {
            if (chatsArray.length === 0) {
              showError(t('请联系管理员配置聊天链接'));
            } else {
              const first = chatsArray[0];
              onOpenLink(first.name, first.value, record);
            }
          }}
        >
          {t('聊天')}
        </Button>
        <Dropdown trigger='click' position='bottomRight' menu={chatsArray}>
          <Button
            type='tertiary'
            icon={<IconTreeTriangleDown />}
            size='small'
          ></Button>
        </Dropdown>
      </SplitButtonGroup>

      {record.status === 1 ? (
        <Button
          type='danger'
          size='small'
          onClick={async () => {
            await manageToken(record.id, 'disable', record);
            await refresh();
          }}
        >
          {t('禁用')}
        </Button>
      ) : (
        <Button
          size='small'
          onClick={async () => {
            await manageToken(record.id, 'enable', record);
            await refresh();
          }}
        >
          {t('启用')}
        </Button>
      )}

      {record.used_token_count > 0 && (
        <Button
          type='tertiary'
          size='small'
          onClick={async () => {
            await resetUsedCount(record.id);
            await refresh();
          }}
        >
          {t('重置用量')}
        </Button>
      )}

      <Button
        type='tertiary'
        size='small'
        onClick={() => {
          setEditingToken(record);
          setShowEdit(true);
        }}
      >
        {t('编辑')}
      </Button>

      <Button
        type='danger'
        size='small'
        onClick={() => {
          Modal.confirm({
            title: t('确定是否要删除此令牌？'),
            content: t('此修改将不可逆'),
            onOk: () => {
              (async () => {
                await manageToken(record.id, 'delete', record);
                await refresh();
              })();
            },
          });
        }}
      >
        {t('删除')}
      </Button>
    </Space>
  );
};

export const getTokensColumns = ({
  t,
  showKeys,
  resolvedTokenKeys,
  loadingTokenKeys,
  toggleTokenVisibility,
  copyTokenKey,
  copyTokenConnectionString,
  manageToken,
  onOpenLink,
  setEditingToken,
  setShowEdit,
  refresh,
  resetUsedCount,
  groupRatios = {},
  rateLimitStatuses = {},
}) => {
  return [
    {
      title: t('名称'),
      dataIndex: 'name',
    },
    {
      title: t('状态'),
      dataIndex: 'status',
      key: 'status',
      render: (text, record) => renderStatus(text, record, t),
    },
    {
      title: t('剩余额度/总额度'),
      key: 'quota_usage',
      render: (text, record) => renderQuotaUsage(text, record, t),
    },
    {
      title: t('Token用量/限制'),
      key: 'token_count_usage',
      render: (text, record) => {
        const used = record.used_token_count || 0;
        const limit = record.token_count_limit || 0;
        const formatM = (n) => {
          const m = n / 1000000;
          if (m >= 100) return m.toFixed(0);
          if (m >= 10) return m.toFixed(1);
          return m.toFixed(2);
        };
        if (limit === 0) {
          return (
            <div>
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--semi-color-text-1)' }}>
                {t('已用')} {formatM(used)}M / {t('不限制')}
              </div>
              <div style={{ background: 'var(--semi-color-fill-0)', borderRadius: 4, height: 6 }}>
                <div style={{
                  background: 'var(--semi-color-primary)',
                  borderRadius: 4,
                  height: 6,
                  width: '100%',
                  opacity: used > 0 ? 1 : 0.3,
                  transition: 'width 0.3s',
                }} />
              </div>
            </div>
          );
        }
        const percent = Math.min((used / limit) * 100, 100);
        return (
          <div>
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              {formatM(used)}M / {formatM(limit)}M
            </div>
            <div style={{ background: 'var(--semi-color-fill-0)', borderRadius: 4, height: 6 }}>
              <div style={{
                background: percent >= 90 ? '#e74c3c' : percent >= 70 ? '#f39c12' : 'var(--semi-color-primary)',
                borderRadius: 4,
                height: 6,
                width: percent + '%',
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        );
      },
    },
    {
      title: t('分组'),
      dataIndex: 'group',
      key: 'group',
      render: (text, record) => renderGroupColumn(text, record, t, groupRatios),
    },
    {
      title: t('限流信息'),
      key: 'rate_limit_info',
      render: (text, record) => {
        if (!record.rate_limit_enabled) {
          return <span style={{ color: 'var(--semi-color-text-2)' }}>{t('未启用')}</span>;
        }
        const status = rateLimitStatuses[record.id] || {};
        const totalUsed = status.total_used || 0;
        const successUsed = status.success_used || 0;
        const totalLimit = record.rate_limit_total || 0;
        const successLimit = record.rate_limit_success || 0;
        const periodSeconds = record.rate_limit_period || 0;
        const resetAt = status.reset_at || '';

        const formatPeriod = (s) => {
          if (s >= 86400) return (s / 86400).toFixed(0) + t('天');
          if (s >= 3600) return (s / 3600).toFixed(0) + t('小时');
          if (s >= 60) return (s / 60).toFixed(0) + t('分钟');
          return s + 's';
        };

        const formatResetAt = (isoStr) => {
          if (!isoStr) return '-';
          try {
            const d = new Date(isoStr);
            const now = new Date();
            const diffMs = d - now;
            if (diffMs <= 0) return t('已重置');
            const diffMin = Math.floor(diffMs / 60000);
            if (diffMin < 60) return diffMin + t('分钟后重置');
            const diffH = Math.floor(diffMin / 60);
            if (diffH < 24) return diffH + t('小时后重置');
            return Math.floor(diffH / 24) + t('天后重置');
          } catch {
            return '-';
          }
        };

        return (
          <div style={{ fontSize: 12, lineHeight: '1.6' }}>
            <div>{t('周期')}: {formatPeriod(periodSeconds)}</div>
            <div>{t('总调用')}: {totalUsed}{totalLimit > 0 ? `/${totalLimit}` : ''} {t('成功')}: {successUsed}{successLimit > 0 ? `/${successLimit}` : ''}</div>
            <div style={{ color: 'var(--semi-color-text-2)' }}>{formatResetAt(resetAt)}</div>
          </div>
        );
      },
    },
    {
      title: t('密钥'),
      key: 'token_key',
      render: (text, record) =>
        renderTokenKey(
          text,
          record,
          showKeys,
          resolvedTokenKeys,
          loadingTokenKeys,
          toggleTokenVisibility,
          copyTokenKey,
          copyTokenConnectionString,
          t,
        ),
    },
    {
      title: t('可用模型'),
      dataIndex: 'model_limits',
      render: (text, record) => renderModelLimits(text, record, t),
    },
    {
      title: t('IP限制'),
      dataIndex: 'allow_ips',
      render: (text) => renderAllowIps(text, t),
    },
    {
      title: t('创建时间'),
      dataIndex: 'created_time',
      render: (text, record, index) => {
        return <div>{renderTimestamp(text)}</div>;
      },
    },
    {
      title: t('最后使用时间'),
      dataIndex: 'accessed_time',
      render: (text, record, index) => {
        return <div>{text ? renderTimestamp(text) : '-'}</div>;
      },
    },
    {
      title: t('过期时间'),
      dataIndex: 'expired_time',
      render: (text, record, index) => {
        return (
          <div>
            {record.expired_time === -1 ? t('永不过期') : renderTimestamp(text)}
          </div>
        );
      },
    },
    {
      title: '',
      dataIndex: 'operate',
      fixed: 'right',
      render: (text, record, index) =>
        renderOperations(
          text,
          record,
          onOpenLink,
          setEditingToken,
          setShowEdit,
          manageToken,
          refresh,
          resetUsedCount,
          t,
        ),
    },
  ];
};
