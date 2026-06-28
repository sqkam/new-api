package middleware

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// RecordFirstCallTime records the timestamp of a token's first successful API
// call into first_call_time. This runs for every token regardless of whether
// rate limiting or first-call-based expiration is enabled.
//
// The anchor is recorded so that if the user later switches the token to
// first-call-based expiration (ExpiredFromFirstCall=true), the expiration time
// can be computed as FirstCallTime + ExpiredDuration using the original
// first-call timestamp rather than waiting for another call to activate it.
//
// On the first successful call, if ExpiredFromFirstCall is enabled with a
// positive ExpiredDuration, the expiration time is also activated as
// FirstCallTime + ExpiredDuration. Subsequent calls never change either field.
//
// This middleware must be registered after TokenAuth so that token_id,
// token_first_call_time, token_expired_from_first_call and
// token_expired_duration are available in the context.
func RecordFirstCallTime() gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenId := c.GetInt("token_id")
		if tokenId == 0 {
			c.Next()
			return
		}

		c.Next()

		// Only record on successful responses.
		if c.Writer.Status() >= 400 {
			return
		}

		// Already recorded — first-call anchor is frozen after activation.
		if c.GetInt64("token_first_call_time") > 0 {
			return
		}

		tokenKey := c.GetString("token_key")
		if tokenKey == "" {
			return
		}

		now := common.GetTimestamp()
		expiredFromFirstCall := c.GetBool("token_expired_from_first_call")
		expiredDuration := c.GetInt("token_expired_duration")

		// If first-call-based expiration is enabled with a positive duration,
		// atomically record the anchor and activate the expiration time.
		// Otherwise just record the anchor so it can be reused later if the
		// user switches the token to first-call-based expiration.
		if expiredFromFirstCall && expiredDuration > 0 {
			newExpiredTime := now + int64(expiredDuration)
			if err := model.SetTokenFirstCallAndExpiration(tokenId, now, newExpiredTime); err != nil {
				common.SysLog("failed to set token first-call expiration: " + err.Error())
				return
			}
		} else {
			if err := model.SetTokenFirstCallTime(tokenId, now); err != nil {
				common.SysLog("failed to record token first call time: " + err.Error())
				return
			}
		}

		// Update context so later handlers see the recorded anchor.
		c.Set("token_first_call_time", now)

		// Invalidate cache so the next request picks up the new state.
		if common.RedisEnabled {
			_ = model.CacheDeleteToken(tokenKey)
		}
	}
}
