-- Atomic email-based rate limiting script.
--
-- KEYS[1]: Redis key for this email's attempt counter (e.g. "rl:email:{email}")
-- ARGV[1]: window in seconds (e.g. 60)
-- ARGV[2]: max attempts allowed (e.g. 5)
--
-- Returns: current count after increment.
-- The caller compares this to ARGV[2] to decide whether to block.
--
-- Atomicity: INCR + EXPIRE in a single Lua execution — no race conditions.

local key = KEYS[1]
local window = tonumber(ARGV[1])
local current = redis.call("INCR", key)

-- Set expiry only on the first increment (avoids resetting the window on every call)
if current == 1 then
    redis.call("EXPIRE", key, window)
end

return current
