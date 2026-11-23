-- 20261123100000_swap_order_item_expected_line.sql kept the old 4-argument
-- swap_order_item (picks the line by index alone, so a stale order sheet
-- can change the wrong drink) only so the frontend live at the time kept
-- working. Apply this once the frontend that sends the expected drink and
-- sugar (6fb8af4) is deployed.

drop function if exists swap_order_item(text, integer, text, text);
