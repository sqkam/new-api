package reasoning

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsReasoningEffortValidationError(t *testing.T) {
	tests := []struct {
		name   string
		errMsg string
		want   bool
	}{
		{
			name:   "SGLang literal_error",
			errMsg: `1 validation error: {'type': 'literal_error', 'loc': ('body', 'reasoning_effort'), 'msg': "Input should be 'low', 'medium' or 'high'", 'input': 'max'}`,
			want:   true,
		},
		{
			name:   "reasoning_effort should be",
			errMsg: "reasoning_effort should be one of low, medium, high",
			want:   true,
		},
		{
			name:   "reasoning_effort must be",
			errMsg: "reasoning_effort must be low, medium, or high",
			want:   true,
		},
		{
			name:   "invalid reasoning_effort",
			errMsg: "invalid reasoning_effort value",
			want:   true,
		},
		{
			name:   "reasoning_effort validation failed",
			errMsg: "reasoning_effort validation error",
			want:   true,
		},
		{
			name:   "unrelated error",
			errMsg: "model not found",
			want:   false,
		},
		{
			name:   "empty string",
			errMsg: "",
			want:   false,
		},
		{
			name:   "only reasoning_effort without validation keyword",
			errMsg: "reasoning_effort is set",
			want:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsReasoningEffortValidationError(tt.errMsg)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestDowngradeReasoningEffort(t *testing.T) {
	tests := []struct {
		name           string
		effort         string
		wantDowngraded string
		wantChanged    bool
	}{
		{
			name:           "max -> high",
			effort:         "max",
			wantDowngraded: "high",
			wantChanged:    true,
		},
		{
			name:           "xhigh -> high",
			effort:         "xhigh",
			wantDowngraded: "high",
			wantChanged:    true,
		},
		{
			name:           "minimal -> low",
			effort:         "minimal",
			wantDowngraded: "low",
			wantChanged:    true,
		},
		{
			name:           "high unchanged",
			effort:         "high",
			wantDowngraded: "high",
			wantChanged:    false,
		},
		{
			name:           "medium unchanged",
			effort:         "medium",
			wantDowngraded: "medium",
			wantChanged:    false,
		},
		{
			name:           "low unchanged",
			effort:         "low",
			wantDowngraded: "low",
			wantChanged:    false,
		},
		{
			name:           "empty unchanged",
			effort:         "",
			wantDowngraded: "",
			wantChanged:    false,
		},
		{
			name:           "unknown non-standard -> high",
			effort:         "ultra",
			wantDowngraded: "high",
			wantChanged:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			downgraded, changed := DowngradeReasoningEffort(tt.effort)
			assert.Equal(t, tt.wantDowngraded, downgraded)
			assert.Equal(t, tt.wantChanged, changed)
		})
	}
}
