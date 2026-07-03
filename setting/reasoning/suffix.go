package reasoning

import (
	"strings"

	"github.com/samber/lo"
)

var EffortSuffixes = []string{"-max", "-xhigh", "-high", "-medium", "-low", "-minimal"}

var OpenAIEffortSuffixes = []string{"-high", "-minimal", "-low", "-medium", "-none", "-xhigh"}

var DeepSeekV4EffortSuffixes = []string{"-none", "-max"}

// StandardOpenAIEfforts 是 OpenAI API 规范中 reasoning_effort 的合法值（从高到低排列）
var StandardOpenAIEfforts = []string{"high", "medium", "low"}

// IsReasoningEffortValidationError 判断错误消息是否为上游 reasoning_effort 参数验证错误
// 典型错误如 SGLang: "Input should be 'low', 'medium' or 'high'"
func IsReasoningEffortValidationError(errMsg string) bool {
	if errMsg == "" {
		return false
	}
	lower := strings.ToLower(errMsg)
	return strings.Contains(lower, "reasoning_effort") &&
		(strings.Contains(lower, "should be") ||
			strings.Contains(lower, "must be") ||
			strings.Contains(lower, "invalid") ||
			strings.Contains(lower, "validation") ||
			strings.Contains(lower, "literal_error"))
}

// DowngradeReasoningEffort 将非标准 effort 值降级为 OpenAI 标准值
// 降级规则：max/xhigh → high, minimal → low, 其他非标准值 → high
// 如果 effort 已经是标准值（low/medium/high），则不做降级返回原值和 false
func DowngradeReasoningEffort(effort string) (downgraded string, changed bool) {
	if effort == "" {
		return "", false
	}
	// 已经是标准值，不需要降级
	if lo.Contains(StandardOpenAIEfforts, effort) {
		return effort, false
	}
	// 降级映射
	switch effort {
	case "max", "xhigh":
		return "high", true
	case "minimal":
		return "low", true
	default:
		// 其他非标准值降级为 high（最高标准档位）
		return "high", true
	}
}

// TrimEffortSuffix -> modelName level(low) exists
func TrimEffortSuffix(modelName string) (string, string, bool) {
	return TrimEffortSuffixWithSuffixes(modelName, EffortSuffixes)
}

func TrimEffortSuffixWithSuffixes(modelName string, suffixes []string) (string, string, bool) {
	suffix, found := lo.Find(suffixes, func(s string) bool {
		return strings.HasSuffix(modelName, s)
	})
	if !found {
		return modelName, "", false
	}
	return strings.TrimSuffix(modelName, suffix), strings.TrimPrefix(suffix, "-"), true
}

func ParseOpenAIReasoningEffortFromModelSuffix(modelName string) (string, string) {
	baseModel, effort, ok := TrimEffortSuffixWithSuffixes(modelName, OpenAIEffortSuffixes)
	if !ok {
		return "", modelName
	}
	return effort, baseModel
}

func ParseDeepSeekV4ThinkingSuffix(modelName string) (baseModel string, thinkingType string, effort string, ok bool) {
	baseModel, suffix, ok := TrimEffortSuffixWithSuffixes(modelName, DeepSeekV4EffortSuffixes)
	if !ok || !strings.HasPrefix(baseModel, "deepseek-v4-") {
		return modelName, "", "", false
	}
	switch suffix {
	case "none":
		return baseModel, "disabled", "", true
	case "max":
		return baseModel, "enabled", "max", true
	default:
		return modelName, "", "", false
	}
}
