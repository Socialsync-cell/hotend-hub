CREATE SCHEMA IF NOT EXISTS hotend_hub;
SET search_path TO hotend_hub;

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  shopify_customer_id TEXT UNIQUE,
  email TEXT UNIQUE,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  marketing_status TEXT NOT NULL DEFAULT 'NOT_SUBSCRIBED',
  marketing_opt_in_level TEXT,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_spent NUMERIC(12,2) NOT NULL DEFAULT 0,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  shopify_order_id TEXT UNIQUE NOT NULL,
  order_name TEXT,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  email TEXT,
  total_price NUMERIC(12,2),
  currency TEXT,
  financial_status TEXT,
  fulfillment_status TEXT,
  created_at_shopify TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shopify_line_item_id TEXT,
  shopify_product_id TEXT,
  shopify_variant_id TEXT,
  product_title TEXT NOT NULL,
  variant_title TEXT,
  sku TEXT,
  quantity INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id BIGSERIAL PRIMARY KEY,
  reference TEXT UNIQUE NOT NULL,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  mode TEXT NOT NULL DEFAULT 'AI',
  marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  preheader TEXT,
  headline TEXT,
  body_text TEXT,
  cta_text TEXT,
  cta_url TEXT,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_events (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  campaign_id BIGINT REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  provider_message_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS review_requests (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  token_hash TEXT UNIQUE NOT NULL,
  sent_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_reviews (
  id BIGSERIAL PRIMARY KEY,
  review_request_id BIGINT REFERENCES review_requests(id) ON DELETE SET NULL,
  order_item_id BIGINT REFERENCES order_items(id) ON DELETE SET NULL,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  shopify_product_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  feedback TEXT,
  approved BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS popups (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  popup_type TEXT NOT NULL DEFAULT 'PROMO',
  headline TEXT NOT NULL,
  body_text TEXT,
  image_url TEXT,
  cta_text TEXT,
  cta_url TEXT,
  discount_code TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  targeting JSONB NOT NULL DEFAULT '{}',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipments (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE,
  carrier TEXT,
  tracking_number TEXT,
  tracking_url TEXT,
  status TEXT NOT NULL DEFAULT 'COURIER_BOOKED_FOR_PICKUP',
  last_event_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(carrier, tracking_number)
);

CREATE TABLE IF NOT EXISTS shipment_events (
  id BIGSERIAL PRIMARY KEY,
  shipment_id BIGINT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  description TEXT,
  location TEXT,
  event_time TIMESTAMPTZ,
  raw JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id BIGSERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  module TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO automation_rules(key,name,module,config) VALUES
('welcome-story','Our Story','marketing','{"trigger":"marketing_subscribed","delay_minutes":0}'),
('abandoned-cart','Abandoned Cart','marketing','{"delays_days":[1,5,10]}'),
('post-purchase-review','Product Review Request','reviews','{"delay_days":7}'),
('delivery-review-followup','Delivered Order Review','reviews','{"trigger":"delivered"}')
ON CONFLICT(key) DO NOTHING;


CREATE TABLE IF NOT EXISTS shopify_installations (
  shop_domain TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  scope TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGSERIAL PRIMARY KEY,
  webhook_id TEXT UNIQUE NOT NULL,
  topic TEXT NOT NULL,
  shop_domain TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS webhook_events_topic_received_idx
  ON webhook_events(topic, received_at DESC);


CREATE TABLE IF NOT EXISTS email_deliveries (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  campaign_id BIGINT REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  email_type TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'RESEND',
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS email_deliveries_recipient_created_idx
  ON email_deliveries(recipient, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS email_deliveries_welcome_once_idx
  ON email_deliveries(customer_id, email_type)
  WHERE email_type='WELCOME_STORY' AND status IN ('SENT','QUEUED');


CREATE TABLE IF NOT EXISTS abandoned_checkouts (
  id BIGSERIAL PRIMARY KEY,
  shopify_checkout_id TEXT UNIQUE NOT NULL,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  email TEXT,
  customer_first_name TEXT,
  recovery_url TEXT,
  currency TEXT,
  total_price NUMERIC(12,2),
  completed_at TIMESTAMPTZ,
  created_at_shopify TIMESTAMPTZ NOT NULL,
  updated_at_shopify TIMESTAMPTZ NOT NULL,
  line_items JSONB NOT NULL DEFAULT '[]',
  recovered BOOLEAN NOT NULL DEFAULT FALSE,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS abandoned_checkout_steps (
  id BIGSERIAL PRIMARY KEY,
  abandoned_checkout_id BIGINT NOT NULL REFERENCES abandoned_checkouts(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL CHECK(step_number BETWEEN 1 AND 3),
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  email_delivery_id BIGINT REFERENCES email_deliveries(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(abandoned_checkout_id, step_number)
);

CREATE INDEX IF NOT EXISTS abandoned_checkout_steps_due_idx
  ON abandoned_checkout_steps(status,due_at);


CREATE TABLE IF NOT EXISTS review_schedules (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  review_request_id BIGINT REFERENCES review_requests(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS review_schedules_due_idx
  ON review_schedules(status,due_at);

ALTER TABLE product_reviews
  ADD COLUMN IF NOT EXISTS requested_materials TEXT,
  ADD COLUMN IF NOT EXISTS requested_colours TEXT;


CREATE TABLE IF NOT EXISTS campaign_recipients (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  email_delivery_id BIGINT REFERENCES email_deliveries(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(campaign_id,customer_id)
);

CREATE INDEX IF NOT EXISTS campaign_recipients_status_idx
  ON campaign_recipients(campaign_id,status,id);


ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS carrier_watch_id TEXT,
  ADD COLUMN IF NOT EXISTS carrier_sync_status TEXT,
  ADD COLUMN IF NOT EXISTS carrier_last_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS carrier_error TEXT;


INSERT INTO popups(name,popup_type,headline,body_text,image_url,cta_text,discount_code,enabled,targeting)
SELECT
  'Hotend signup offer',
  'NEWSLETTER',
  'Get 10% OFF your order',
  'Sign up and unlock your instant discount.',
  'https://cdn.shopify.com/s/files/1/1006/1519/2875/files/hotend-filament-supplies-logo.jpg?v=1791002415',
  'Claim discount',
  NULL,
  TRUE,
  '{"show_on_entry":true,"dock_on_close":true,"marketing_checked_by_default":true}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM popups WHERE popup_type='NEWSLETTER');


CREATE TABLE IF NOT EXISTS chat_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id=1),
  ai_mode TEXT NOT NULL DEFAULT 'DRAFT' CHECK (ai_mode IN ('OFF','DRAFT','AUTO')),
  ai_model TEXT NOT NULL DEFAULT 'gpt-6.1-sol',
  ai_max_output_tokens INTEGER NOT NULL DEFAULT 350,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_phone TEXT,
  whatsapp_message TEXT NOT NULL DEFAULT 'Hi Hotend, I need some help.',
  human_handoff_text TEXT NOT NULL DEFAULT 'I’ll pass this to the Hotend team.',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO chat_settings(id)
VALUES(1)
ON CONFLICT(id) DO NOTHING;

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS ai_summary TEXT,
  ADD COLUMN IF NOT EXISTS ai_last_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS needs_human BOOLEAN NOT NULL DEFAULT FALSE;


ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS ai_draft TEXT;


ALTER TABLE chat_settings
  ADD COLUMN IF NOT EXISTS whatsapp_staff_phone TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_template_name TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_template_language TEXT NOT NULL DEFAULT 'en';

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS whatsapp_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_notify_error TEXT;

CREATE TABLE IF NOT EXISTS whatsapp_staff_bridges (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  outbound_message_id TEXT UNIQUE,
  staff_phone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_staff_reply_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS whatsapp_staff_bridges_session_idx
  ON whatsapp_staff_bridges(session_id,created_at DESC);


ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS close_reason TEXT,
  ADD COLUMN IF NOT EXISTS transcript_sent_at TIMESTAMPTZ;


INSERT INTO automation_rules(key,name,module,config) VALUES
('chat-transcript','Chat Transcript','chat','{"idle_minutes":10}')
ON CONFLICT(key) DO NOTHING;


ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS image_url TEXT;


ALTER TABLE product_reviews
  ADD COLUMN IF NOT EXISTS reviewer_name TEXT,
  ADD COLUMN IF NOT EXISTS submitted_order_number TEXT;

CREATE TABLE IF NOT EXISTS review_photos (
  id BIGSERIAL PRIMARY KEY,
  review_id BIGINT NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL,
  image_data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_photos_review_id ON review_photos(review_id);


-- Normalize Hotend signup popup
UPDATE popups
SET discount_code='PRINTWITHHOTEND'
WHERE popup_type='NEWSLETTER'
  AND name='Hotend signup offer';

UPDATE popups
SET enabled=FALSE
WHERE popup_type='PROMO'
  AND name='Hotend signup offer';


ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS phone TEXT;


ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_method TEXT;


ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;


-- Use GPT-6.1 Sol for Hotend Hub customer chat
UPDATE chat_settings
SET ai_model='gpt-6.1-sol', updated_at=NOW()
WHERE id=1 AND ai_model<>'gpt-6.1-sol';


-- Seed editable side-tab label for existing Hotend signup popup
UPDATE popups
SET targeting = COALESCE(targeting,'{}'::jsonb) || jsonb_build_object(
  'side_tab_text',
  COALESCE(NULLIF(targeting->>'side_tab_text',''), headline, 'Hotend offer')
)
WHERE popup_type='NEWSLETTER'
  AND name='Hotend signup offer';
