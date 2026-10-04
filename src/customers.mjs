import {q} from './db.mjs';

export async function listCustomers({search='',limit=200}={}){
  const term=String(search||'').trim().toLowerCase();
  const params=[];
  let where='';
  if(term){
    params.push('%'+term+'%');
    where=`WHERE LOWER(COALESCE(c.email,'')) LIKE $1
      OR LOWER(COALESCE(c.first_name,'')) LIKE $1
      OR LOWER(COALESCE(c.last_name,'')) LIKE $1
      OR LOWER(COALESCE(c.shopify_customer_id,'')) LIKE $1`;
  }
  params.push(Math.max(1,Math.min(500,Number(limit)||200)));
  return (await q(`SELECT c.*,
    (SELECT COUNT(*)::int FROM orders o WHERE o.customer_id=c.id) order_count,
    (SELECT COUNT(*)::int FROM chat_sessions s WHERE s.customer_id=c.id) chat_count,
    (SELECT COUNT(*)::int FROM product_reviews r WHERE r.customer_id=c.id) review_count,
    (SELECT COUNT(*)::int FROM email_deliveries e WHERE e.customer_id=c.id AND e.status='SENT') email_count
    FROM customers c
    ${where}
    ORDER BY c.updated_at DESC,c.id DESC
    LIMIT $${params.length}`,params)).rows;
}

export async function getCustomerProfile(id){
  const customer=(await q(`SELECT * FROM customers WHERE id=$1 LIMIT 1`,[Number(id)])).rows[0];
  if(!customer)return null;

  const [orders,chats,reviews,emails,abandoned,shipments]=await Promise.all([
    q(`SELECT id,order_name,email,total_price,currency,financial_status,fulfillment_status,created_at_shopify
      FROM orders WHERE customer_id=$1 ORDER BY created_at_shopify DESC,id DESC LIMIT 50`,[customer.id]),
    q(`SELECT id,reference,mode,marketing_opt_in,started_at,last_activity_at,closed_at,
      (SELECT message FROM chat_messages m WHERE m.session_id=s.id ORDER BY m.id DESC LIMIT 1) last_message
      FROM chat_sessions s WHERE customer_id=$1 ORDER BY last_activity_at DESC LIMIT 50`,[customer.id]),
    q(`SELECT pr.id,pr.shopify_product_id,pr.rating,pr.feedback,pr.requested_materials,pr.requested_colours,pr.approved,pr.created_at,
      oi.product_title,oi.variant_title
      FROM product_reviews pr
      LEFT JOIN order_items oi ON oi.id=pr.order_item_id
      WHERE pr.customer_id=$1 ORDER BY pr.created_at DESC LIMIT 50`,[customer.id]),
    q(`SELECT id,email_type,recipient,subject,status,error,created_at,sent_at
      FROM email_deliveries WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 100`,[customer.id]),
    q(`SELECT id,shopify_checkout_id,email,total_price,currency,recovery_url,recovered,created_at_shopify,updated_at_shopify
      FROM abandoned_checkouts WHERE customer_id=$1 ORDER BY created_at_shopify DESC LIMIT 50`,[customer.id]),
    q(`SELECT s.id,s.carrier,s.tracking_number,s.tracking_url,s.status,s.last_event_at,s.delivered_at,o.order_name
      FROM shipments s JOIN orders o ON o.id=s.order_id
      WHERE o.customer_id=$1 ORDER BY COALESCE(s.last_event_at,s.created_at) DESC LIMIT 50`,[customer.id])
  ]);

  return {
    customer,
    orders:orders.rows,
    chats:chats.rows,
    reviews:reviews.rows,
    emails:emails.rows,
    abandoned:abandoned.rows,
    shipments:shipments.rows
  };
}

export async function customerStats(){
  return (await q(`SELECT
    COUNT(*)::int total,
    COUNT(*) FILTER (WHERE marketing_status='SUBSCRIBED')::int subscribed,
    COUNT(*) FILTER (WHERE total_orders>0)::int buyers,
    COALESCE(SUM(total_spent),0)::numeric(14,2) lifetime_value
    FROM customers`)).rows[0];
}
