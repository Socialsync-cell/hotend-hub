import {q} from './db.mjs';
import {customerPages,orderPages,abandonedCheckoutPages,gql} from './shopify.mjs';

function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}

export async function syncShopifyCore(){
  const stats={customers:0,orders:0,items:0};
  for await(const customers of customerPages()){
    for(const c of customers){
      const email=c.defaultEmailAddress?.emailAddress?.trim().toLowerCase()||null;
      const marketing=c.defaultEmailAddress?.marketingState||'NOT_SUBSCRIBED';
      const optIn=c.defaultEmailAddress?.marketingOptInLevel||null;
      await q(`INSERT INTO customers(shopify_customer_id,email,first_name,last_name,phone,marketing_status,marketing_opt_in_level,total_orders,total_spent,tags,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
        ON CONFLICT(shopify_customer_id) DO UPDATE SET
          email=EXCLUDED.email,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,phone=EXCLUDED.phone,
          marketing_status=EXCLUDED.marketing_status,marketing_opt_in_level=EXCLUDED.marketing_opt_in_level,
          total_orders=EXCLUDED.total_orders,total_spent=EXCLUDED.total_spent,tags=EXCLUDED.tags,updated_at=NOW()`,[
        c.id,email,c.firstName||null,c.lastName||null,c.defaultPhoneNumber?.phoneNumber||null,marketing,optIn,Number(c.numberOfOrders||0),num(c.amountSpent?.amount),c.tags||[]
      ]);
      stats.customers++;
    }
  }

  for await(const orders of orderPages()){
    for(const o of orders){
      const email=o.email?.trim().toLowerCase()||null;
      const customerId=o.customer?.id?(await q(`SELECT id FROM customers WHERE shopify_customer_id=$1 LIMIT 1`,[o.customer.id])).rows[0]?.id:null;
      const money=o.currentTotalPriceSet?.shopMoney||{};
      const saved=await q(`INSERT INTO orders(shopify_order_id,order_name,customer_id,email,phone,shipping_method,total_price,currency,financial_status,fulfillment_status,fulfilled_at,created_at_shopify)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(shopify_order_id) DO UPDATE SET
          order_name=EXCLUDED.order_name,customer_id=EXCLUDED.customer_id,email=EXCLUDED.email,phone=EXCLUDED.phone,shipping_method=EXCLUDED.shipping_method,total_price=EXCLUDED.total_price,
          currency=EXCLUDED.currency,financial_status=EXCLUDED.financial_status,fulfillment_status=EXCLUDED.fulfillment_status,
          fulfilled_at=EXCLUDED.fulfilled_at,created_at_shopify=EXCLUDED.created_at_shopify
        RETURNING id`,[
        o.id,o.name||null,customerId,email,o.shippingAddress?.phone||o.billingAddress?.phone||o.shippingLine?.phone||null,o.shippingLine?.title||o.shippingLine?.code||null,num(money.amount),money.currencyCode||null,o.displayFinancialStatus||null,o.displayFulfillmentStatus||null,(o.fulfillments||[]).map(f=>f.updatedAt).filter(Boolean).sort().slice(-1)[0]||null,o.createdAt
      ]);
      const orderId=saved.rows[0].id;
      await q(`DELETE FROM order_items WHERE order_id=$1`,[orderId]);
      for(const item of o.lineItems?.nodes||[]){
        await q(`INSERT INTO order_items(order_id,shopify_line_item_id,shopify_product_id,shopify_variant_id,product_title,variant_title,sku,quantity,image_url)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[
          orderId,item.id,item.product?.id||null,item.variant?.id||null,item.title||item.name||'Product',item.variantTitle||null,item.sku||null,Number(item.quantity||1),
          item.variant?.image?.url||item.product?.featuredImage?.url||null
        ]);
        stats.items++;
      }
      for(const fulfillment of o.fulfillments||[]){
        const infos=fulfillment.trackingInfo||[];
        for(const info of infos){
          const trackingNumber=String(info.number||'').trim();
          if(!trackingNumber)continue;
          const carrier=info.company||'Shopify';
          const previous=(await q(`SELECT id,status FROM shipments WHERE carrier=$1 AND tracking_number=$2 LIMIT 1`,[carrier,trackingNumber])).rows[0]||null;
          const savedShipment=(await q(`INSERT INTO shipments(order_id,carrier,tracking_number,tracking_url,status,last_event_at)
            VALUES($1,$2,$3,$4,$5,$6)
            ON CONFLICT(carrier,tracking_number) DO UPDATE SET
              order_id=EXCLUDED.order_id,
              tracking_url=COALESCE(EXCLUDED.tracking_url,shipments.tracking_url),
              status=EXCLUDED.status,
              last_event_at=EXCLUDED.last_event_at
            RETURNING id,status`,[
            orderId,carrier,trackingNumber,info.url||null,fulfillment.status||'COURIER_BOOKED_FOR_PICKUP',fulfillment.updatedAt||null
          ])).rows[0];
          if(!previous||previous.status!==savedShipment.status){
            await q(`INSERT INTO shipment_events(shipment_id,status,description,event_time,raw)
              VALUES($1,$2,$3,$4,$5::jsonb)`,[
              savedShipment.id,savedShipment.status,
              savedShipment.status==='SUCCESS'?'Delivered':'Shopify fulfillment update',
              fulfillment.updatedAt||new Date().toISOString(),
              JSON.stringify({source:'shopify',fulfillment_id:fulfillment.id||null})
            ]);
          }
        }
      }
      stats.orders++;
    }
  }
  return stats;
}


async function saveCustomer(c){
  const email=c.defaultEmailAddress?.emailAddress?.trim().toLowerCase()||null;
  const marketing=c.defaultEmailAddress?.marketingState||'NOT_SUBSCRIBED';
  const optIn=c.defaultEmailAddress?.marketingOptInLevel||null;
  const result=await q(`INSERT INTO customers(shopify_customer_id,email,first_name,last_name,phone,marketing_status,marketing_opt_in_level,total_orders,total_spent,tags,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
    ON CONFLICT(shopify_customer_id) DO UPDATE SET
      email=EXCLUDED.email,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,phone=EXCLUDED.phone,
      marketing_status=EXCLUDED.marketing_status,marketing_opt_in_level=EXCLUDED.marketing_opt_in_level,
      total_orders=EXCLUDED.total_orders,total_spent=EXCLUDED.total_spent,tags=EXCLUDED.tags,updated_at=NOW()
    RETURNING id`,[
      c.id,email,c.firstName||null,c.lastName||null,c.defaultPhoneNumber?.phoneNumber||null,marketing,optIn,Number(c.numberOfOrders||0),num(c.amountSpent?.amount),c.tags||[]
    ]);
  return result.rows[0]?.id||null;
}

async function saveOrder(o){
  const email=o.email?.trim().toLowerCase()||null;
  const customerId=o.customer?.id?(await q(`SELECT id FROM customers WHERE shopify_customer_id=$1 LIMIT 1`,[o.customer.id])).rows[0]?.id:null;
  const money=o.currentTotalPriceSet?.shopMoney||{};
  const saved=await q(`INSERT INTO orders(shopify_order_id,order_name,customer_id,email,phone,shipping_method,total_price,currency,financial_status,fulfillment_status,fulfilled_at,created_at_shopify)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT(shopify_order_id) DO UPDATE SET
      order_name=EXCLUDED.order_name,customer_id=EXCLUDED.customer_id,email=EXCLUDED.email,phone=EXCLUDED.phone,shipping_method=EXCLUDED.shipping_method,total_price=EXCLUDED.total_price,
      currency=EXCLUDED.currency,financial_status=EXCLUDED.financial_status,fulfillment_status=EXCLUDED.fulfillment_status,
      fulfilled_at=EXCLUDED.fulfilled_at,created_at_shopify=EXCLUDED.created_at_shopify
    RETURNING id`,[
      o.id,o.name||null,customerId,email,o.shippingAddress?.phone||o.billingAddress?.phone||o.shippingLine?.phone||null,o.shippingLine?.title||o.shippingLine?.code||null,num(money.amount),money.currencyCode||null,o.displayFinancialStatus||null,o.displayFulfillmentStatus||null,(o.fulfillments||[]).map(f=>f.updatedAt).filter(Boolean).sort().slice(-1)[0]||null,o.createdAt
    ]);
  const orderId=saved.rows[0].id;
  await q(`DELETE FROM order_items WHERE order_id=$1`,[orderId]);
  for(const item of o.lineItems?.nodes||[]){
    await q(`INSERT INTO order_items(order_id,shopify_line_item_id,shopify_product_id,shopify_variant_id,product_title,variant_title,sku,quantity,image_url)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[
      orderId,item.id,item.product?.id||null,item.variant?.id||null,item.title||item.name||'Product',item.variantTitle||null,item.sku||null,Number(item.quantity||1),
      item.variant?.image?.url||item.product?.featuredImage?.url||null
    ]);
  }
  for(const fulfillment of o.fulfillments||[]){
    const infos=fulfillment.trackingInfo||[];
    for(const info of infos){
      const trackingNumber=String(info.number||'').trim();
      if(!trackingNumber)continue;
      const carrier=info.company||'Shopify';
      const previous=(await q(`SELECT id,status FROM shipments WHERE carrier=$1 AND tracking_number=$2 LIMIT 1`,[carrier,trackingNumber])).rows[0]||null;
      const savedShipment=(await q(`INSERT INTO shipments(order_id,carrier,tracking_number,tracking_url,status,last_event_at,delivered_at)
        VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(carrier,tracking_number) DO UPDATE SET
          order_id=EXCLUDED.order_id,
          tracking_url=COALESCE(EXCLUDED.tracking_url,shipments.tracking_url),
          status=EXCLUDED.status,
          last_event_at=EXCLUDED.last_event_at,
          delivered_at=COALESCE(EXCLUDED.delivered_at,shipments.delivered_at)
        RETURNING id,status`,[
        orderId,
        carrier,
        trackingNumber,
        info.url||null,
        fulfillment.status||'COURIER_BOOKED_FOR_PICKUP',
        fulfillment.updatedAt||null,
        fulfillment.status==='SUCCESS'?(fulfillment.updatedAt||new Date().toISOString()):null
      ])).rows[0];
      if(!previous||previous.status!==savedShipment.status){
        await q(`INSERT INTO shipment_events(shipment_id,status,description,event_time,raw)
          VALUES($1,$2,$3,$4,$5::jsonb)`,[
          savedShipment.id,
          savedShipment.status,
          savedShipment.status==='SUCCESS'?'Delivered':'Shopify fulfillment update',
          fulfillment.updatedAt||new Date().toISOString(),
          JSON.stringify({source:'shopify',fulfillment_id:fulfillment.id||null})
        ]);
      }
    }
  }
  return {orderId,items:(o.lineItems?.nodes||[]).length};
}

export async function backfillShippingMethods(){
  let checked=0,updated=0;
  for await(const orders of orderPages()){
    for(const o of orders){
      checked++;
      const method=o.shippingLine?.title||o.shippingLine?.code||null;
      if(!method)continue;
      const result=await q(`UPDATE orders
        SET shipping_method=$2
        WHERE shopify_order_id=$1
          AND COALESCE(shipping_method,'')<>COALESCE($2,'')`,[o.id,method]);
      updated+=Number(result.rowCount||0);
    }
  }
  return {checked,updated};
}

export async function backfillOrderPhones(){
  let checked=0,updated=0;
  for await(const orders of orderPages()){
    for(const o of orders){
      checked++;
      const phone=o.shippingAddress?.phone||o.billingAddress?.phone||null;
      if(!phone)continue;
      const result=await q(`UPDATE orders
        SET phone=$2
        WHERE shopify_order_id=$1
          AND COALESCE(phone,'')<>COALESCE($2,'')`,[o.id,phone]);
      updated+=Number(result.rowCount||0);
    }
  }
  return {checked,updated};
}

export async function backfillCustomerPhones(){
  let checked=0,updated=0;
  for await(const customers of customerPages()){
    for(const customer of customers){
      checked++;
      const phone=customer.defaultPhoneNumber?.phoneNumber||null;
      if(!phone)continue;
      const result=await q(`UPDATE customers
        SET phone=$2,updated_at=NOW()
        WHERE shopify_customer_id=$1
          AND phone IS DISTINCT FROM $2`,[customer.id,phone]);
      updated+=Number(result.rowCount||0);
    }
  }
  return {checked,updated};
}

export async function backfillEmailProductImages(){
  const ids=(await q(`SELECT DISTINCT shopify_product_id
    FROM order_items
    WHERE shopify_product_id IS NOT NULL
      AND (image_url IS NULL OR image_url='')
    ORDER BY shopify_product_id`)).rows.map(x=>x.shopify_product_id).filter(Boolean);

  let orderItemsUpdated=0;
  for(let i=0;i<ids.length;i+=50){
    const batch=ids.slice(i,i+50);
    const data=await gql(`query ProductImages($ids:[ID!]!){
      nodes(ids:$ids){
        ... on Product{
          id
          featuredImage{url}
          variants(first:100){nodes{id sku image{url}}}
        }
      }
    }`,{ids:batch});

    for(const p of data.nodes||[]){
      if(!p?.id)continue;
      const fallback=p.featuredImage?.url||null;
      for(const v of p.variants?.nodes||[]){
        const imageUrl=v.image?.url||fallback;
        if(!imageUrl)continue;
        const result=await q(`UPDATE order_items
          SET image_url=$1
          WHERE shopify_product_id=$2
            AND shopify_variant_id=$3
            AND (image_url IS NULL OR image_url='')`,[
          imageUrl,p.id,v.id
        ]);
        orderItemsUpdated+=Number(result.rowCount||0);
      }
      if(fallback){
        const result=await q(`UPDATE order_items
          SET image_url=$1
          WHERE shopify_product_id=$2
            AND (image_url IS NULL OR image_url='')`,[fallback,p.id]);
        orderItemsUpdated+=Number(result.rowCount||0);
      }
    }
  }

  let abandonedUpdated=0;
  for await(const checkouts of abandonedCheckoutPages()){
    for(const a of checkouts){
      const items=(a.lineItems?.nodes||[]).map(x=>({
        id:x.id,
        title:x.title||'Product',
        variantTitle:x.variantTitle||null,
        sku:x.sku||null,
        quantity:Number(x.quantity||1),
        productId:x.product?.id||null,
        variantId:x.variant?.id||null,
        imageUrl:x.variant?.image?.url||x.product?.featuredImage?.url||null,
        unitPrice:Number(x.originalUnitPriceSet?.shopMoney?.amount||0),
        currency:x.originalUnitPriceSet?.shopMoney?.currencyCode||null
      }));
      if(!items.some(x=>x.imageUrl))continue;
      const result=await q(`UPDATE abandoned_checkouts
        SET line_items=$2::jsonb,last_synced_at=NOW()
        WHERE shopify_checkout_id=$1`,[a.id,JSON.stringify(items)]);
      abandonedUpdated+=Number(result.rowCount||0);
    }
  }

  return {orderItemsUpdated,abandonedUpdated};
}

export async function syncCustomerByNumericId(id){
  if(!id)return {ok:false,reason:'missing_customer_id'};
  const gid=String(id).startsWith('gid://')?String(id):`gid://shopify/Customer/${id}`;
  const data=await gql(`query Customer($id:ID!){
    customer(id:$id){
      id firstName lastName tags numberOfOrders amountSpent{amount currencyCode}
      defaultEmailAddress{emailAddress marketingState marketingOptInLevel marketingUpdatedAt validFormat}
    }
  }`,{id:gid});
  if(!data.customer)return {ok:false,reason:'customer_not_found'};
  await saveCustomer(data.customer);
  return {ok:true,customerId:gid};
}

export async function syncOrderByNumericId(id){
  if(!id)return {ok:false,reason:'missing_order_id'};
  const gid=String(id).startsWith('gid://')?String(id):`gid://shopify/Order/${id}`;
  const data=await gql(`query Order($id:ID!){
    order(id:$id){
      id name createdAt email displayFinancialStatus displayFulfillmentStatus
      currentTotalPriceSet{shopMoney{amount currencyCode}}
      customer{id}
      lineItems(first:100){nodes{id name title variantTitle sku quantity product{id featuredImage{url}} variant{id image{url}}}}
      fulfillments(first:20){
        id status updatedAt
        trackingInfo(first:20){company number url}
      }
    }
  }`,{id:gid});
  if(!data.order)return {ok:false,reason:'order_not_found'};
  if(data.order.customer?.id){
    const existing=(await q(`SELECT id FROM customers WHERE shopify_customer_id=$1 LIMIT 1`,[data.order.customer.id])).rows[0];
    if(!existing){
      const customerNumeric=data.order.customer.id.split('/').pop();
      await syncCustomerByNumericId(customerNumeric);
    }
  }
  const saved=await saveOrder(data.order);
  return {ok:true,orderId:gid,items:saved.items};
}
