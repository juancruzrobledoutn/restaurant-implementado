-- =============================================================================
-- RESET TABLES AND CLEAR ORDER HISTORY
-- Run this to start fresh for testing
-- =============================================================================

-- 1. Delete allocations (depends on payments and charges)
DELETE FROM allocation;

-- 2. Delete payments (depends on checks)
DELETE FROM payment;

-- 3. Delete charges (depends on checks and round_items)
DELETE FROM charge;

-- 4. Delete checks (depends on table_session)
DELETE FROM app_check;

-- 5. Delete kitchen ticket items (depends on kitchen_ticket and round_item)
DELETE FROM kitchen_ticket_item;

-- 6. Delete kitchen tickets (depends on round)
DELETE FROM kitchen_ticket;

-- 7. Delete cart items (depends on diner)
DELETE FROM cart_item;

-- 8. Delete round items (depends on round)
DELETE FROM round_item;

-- 9. Delete rounds (depends on table_session)
DELETE FROM round;

-- 10. Delete service calls (depends on table_session)
DELETE FROM service_call;

-- 11. Delete diners (depends on table_session)
DELETE FROM diner;

-- 12. Delete table sessions
DELETE FROM table_session;

-- 13. Reset all tables to FREE status
UPDATE app_table SET status = 'free' WHERE status != 'free';

-- Show results
SELECT 'Cleanup complete!' as status;
SELECT 'Tables in FREE status:' as info, count(*) as count FROM app_table WHERE status = 'free';
SELECT 'Total tables:' as info, count(*) as count FROM app_table;
