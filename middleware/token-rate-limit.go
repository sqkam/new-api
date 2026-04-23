package middleware

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const (
	tokenRLKeyPrefix     = "tokenRL:"
	tokenRLAllTimePrefix = "tokenRLAllTime:"
)

// tokenRLState holds in-memory rate limit state per token
type tokenRLState struct {
	Total       int
	Success     int
	PeriodStart int64
}

var (
	tokenRLStore = make(map[int]*tokenRLState)
	tokenRLMutex sync.Mutex
)

// TokenRateLimit is a per-token rate limiting middleware.
// It checks total and success request counts within a rolling period.
func TokenRateLimit() func(c *gin.Context) {
	return func(c *gin.Context) {
		enabled := c.GetBool("token_rate_limit_enabled")
		if !enabled {
			c.Next()
			return
		}

		totalLimit := c.GetInt("token_rate_limit_total")
		successLimit := c.GetInt("token_rate_limit_success")
		periodSeconds := c.GetInt("token_rate_limit_period")
		tokenId := c.GetInt("token_id")

		if tokenId == 0 || periodSeconds == 0 {
			c.Next()
			return
		}

		if common.RedisEnabled {
			redisTokenRateLimitHandler(c, tokenId, totalLimit, successLimit, periodSeconds)
		} else {
			memoryTokenRateLimitHandler(c, tokenId, totalLimit, successLimit, periodSeconds)
		}
	}
}

func redisTokenRateLimitHandler(c *gin.Context, tokenId, totalLimit, successLimit, periodSeconds int) {
	ctx := context.Background()
	rdb := common.RDB
	key := fmt.Sprintf("%s%d", tokenRLKeyPrefix, tokenId)
	allTimeTotalKey := fmt.Sprintf("%s%d:total", tokenRLAllTimePrefix, tokenId)
	allTimeSuccessKey := fmt.Sprintf("%s%d:success", tokenRLAllTimePrefix, tokenId)
	now := time.Now().Unix()

	// Get current state from Redis Hash
	totalStr, _ := rdb.HGet(ctx, key, "total").Result()
	successStr, _ := rdb.HGet(ctx, key, "success").Result()
	periodStartStr, _ := rdb.HGet(ctx, key, "period_start").Result()

	var totalCount, successCount int
	var periodStart int64
	fmt.Sscanf(totalStr, "%d", &totalCount)
	fmt.Sscanf(successStr, "%d", &successCount)
	fmt.Sscanf(periodStartStr, "%d", &periodStart)

	// Check if period has expired -> reset counters
	if periodStart == 0 || (now-periodStart) >= int64(periodSeconds) {
		totalCount = 0
		successCount = 0
		periodStart = now
		rdb.HSet(ctx, key, "total", 0, "success", 0, "period_start", now)
		rdb.Expire(ctx, key, time.Duration(periodSeconds+60)*time.Second)
	}

	// Pre-request: check total limit
	if totalLimit > 0 && totalCount >= totalLimit {
		resetAt := time.Unix(periodStart+int64(periodSeconds), 0).Format(time.RFC3339)
		abortWithTokenRateLimitMessage(c, totalLimit, totalCount, 0, successCount, resetAt)
		return
	}

	// Pre-request: check success limit
	if successLimit > 0 && successCount >= successLimit {
		resetAt := time.Unix(periodStart+int64(periodSeconds), 0).Format(time.RFC3339)
		abortWithTokenRateLimitMessage(c, totalLimit, totalCount, successLimit, successCount, resetAt)
		return
	}

	// Increment total counter
	rdb.HIncrBy(ctx, key, "total", 1)
	rdb.Incr(ctx, allTimeTotalKey)

	// Process request
	c.Next()

	// Post-request: handle success and first-call expiration
	if c.Writer.Status() < 400 {
		rdb.HIncrBy(ctx, key, "success", 1)
		rdb.Incr(ctx, allTimeSuccessKey)

		// Handle first-call expiration
		handleFirstCallExpiration(c, tokenId)
	}
}

func memoryTokenRateLimitHandler(c *gin.Context, tokenId, totalLimit, successLimit, periodSeconds int) {
	tokenRLMutex.Lock()
	defer tokenRLMutex.Unlock()

	now := time.Now().Unix()
	state, ok := tokenRLStore[tokenId]
	if !ok || (now-state.PeriodStart) >= int64(periodSeconds) {
		state = &tokenRLState{
			Total:       0,
			Success:     0,
			PeriodStart: now,
		}
		tokenRLStore[tokenId] = state
	}

	// Pre-request: check total limit
	if totalLimit > 0 && state.Total >= totalLimit {
		resetAt := time.Unix(state.PeriodStart+int64(periodSeconds), 0).Format(time.RFC3339)
		abortWithTokenRateLimitMessage(c, totalLimit, state.Total, 0, state.Success, resetAt)
		return
	}

	// Pre-request: check success limit
	if successLimit > 0 && state.Success >= successLimit {
		resetAt := time.Unix(state.PeriodStart+int64(periodSeconds), 0).Format(time.RFC3339)
		abortWithTokenRateLimitMessage(c, totalLimit, state.Total, successLimit, state.Success, resetAt)
		return
	}

	// Increment total
	state.Total++

	// Release lock during request processing
	tokenRLMutex.Unlock()
	c.Next()
	tokenRLMutex.Lock()

	// Post-request: handle success
	if c.Writer.Status() < 400 {
		state.Success++
		// Handle first-call expiration
		handleFirstCallExpiration(c, tokenId)
	}
}

func abortWithTokenRateLimitMessage(c *gin.Context, limit, used, successLimit, successUsed int, resetAt string) {
	c.JSON(http.StatusTooManyRequests, gin.H{
		"error": gin.H{
			"message":       "API key rate limit exceeded",
			"type":          "rate_limit_error",
			"limit":         limit,
			"remaining":     max(0, limit-used),
			"used":          used,
			"success_limit": successLimit,
			"success_used":  successUsed,
			"reset_at":      resetAt,
		},
	})
	c.Abort()
}

// handleFirstCallExpiration sets the token's ExpiredTime on first successful call
// if ExpiredFromFirstCall is enabled and not yet set.
func handleFirstCallExpiration(c *gin.Context, tokenId int) {
	expiredFromFirstCall := c.GetBool("token_expired_from_first_call")
	if !expiredFromFirstCall {
		return
	}

	expiredDuration := c.GetInt("token_expired_duration")
	if expiredDuration <= 0 {
		return
	}

	tokenKey := c.GetString("token_key")
	if tokenKey == "" {
		return
	}

	now := time.Now().Unix()
	newExpiredTime := now + int64(expiredDuration)

	// Update token in DB
	err := model.SetTokenExpiredTime(tokenId, newExpiredTime)
	if err != nil {
		common.SysLog("failed to set token first-call expiration: " + err.Error())
		return
	}

	// Update context to prevent repeated processing in same request
	c.Set("token_expired_from_first_call", false)

	// Invalidate cache so next request picks up new expiration
	if common.RedisEnabled {
		_ = model.CacheDeleteToken(tokenKey)
	}
}

// GetTokenRateLimitStatus returns current rate limit status for a token.
// Used by the API endpoint to show usage info in the frontend.
func GetTokenRateLimitStatus(tokenId int) (map[string]interface{}, error) {
	result := map[string]interface{}{
		"enabled":          false,
		"total_limit":      0,
		"total_used":       0,
		"success_limit":    0,
		"success_used":     0,
		"all_time_total":   0,
		"all_time_success": 0,
		"period_start":     0,
		"reset_at":         "",
	}

	if common.RedisEnabled {
		ctx := context.Background()
		rdb := common.RDB
		key := fmt.Sprintf("%s%d", tokenRLKeyPrefix, tokenId)

		totalStr, _ := rdb.HGet(ctx, key, "total").Result()
		successStr, _ := rdb.HGet(ctx, key, "success").Result()
		periodStartStr, _ := rdb.HGet(ctx, key, "period_start").Result()

		var total, success int
		var periodStart int64
		fmt.Sscanf(totalStr, "%d", &total)
		fmt.Sscanf(successStr, "%d", &success)
		fmt.Sscanf(periodStartStr, "%d", &periodStart)

		allTimeTotalStr, _ := rdb.Get(ctx, fmt.Sprintf("%s%d:total", tokenRLAllTimePrefix, tokenId)).Result()
		allTimeSuccessStr, _ := rdb.Get(ctx, fmt.Sprintf("%s%d:success", tokenRLAllTimePrefix, tokenId)).Result()

		var allTimeTotal, allTimeSuccess int
		fmt.Sscanf(allTimeTotalStr, "%d", &allTimeTotal)
		fmt.Sscanf(allTimeSuccessStr, "%d", &allTimeSuccess)

		result["total_used"] = total
		result["success_used"] = success
		result["all_time_total"] = allTimeTotal
		result["all_time_success"] = allTimeSuccess
		result["period_start"] = periodStart
		if periodStart > 0 {
			result["reset_at"] = time.Unix(periodStart, 0).Format(time.RFC3339)
		}
	} else {
		tokenRLMutex.Lock()
		state, ok := tokenRLStore[tokenId]
		if ok {
			result["total_used"] = state.Total
			result["success_used"] = state.Success
			result["period_start"] = state.PeriodStart
			if state.PeriodStart > 0 {
				result["reset_at"] = time.Unix(state.PeriodStart, 0).Format(time.RFC3339)
			}
		}
		tokenRLMutex.Unlock()
	}

	return result, nil
}
