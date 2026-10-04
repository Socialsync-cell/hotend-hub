import {q} from './db.mjs';

export async function listReviews({status='all',rating='',search='',limit=300}={}){
  const params=[]; const where=[];
  if(status==='approved')where.push('pr.approved=TRUE');
  if(status==='hidden')where.push('pr.approved=FALSE');
  if(rating){
    params.push(Number(rating));
    where.push(`pr.rating=$${params.length}`);
  }
  const term=String(search||'').trim().toLowerCase();
  if(term){
    params.push('%'+term+'%');
    where.push(`(
      LOWER(COALESCE(pr.feedback,'')) LIKE $${params.length}
      OR LOWER(COALESCE(oi.product_title,'')) LIKE $${params.length}
      OR LOWER(COALESCE(oi.variant_title,'')) LIKE $${params.length}
      OR LOWER(COALESCE(c.email,'')) LIKE $${params.length}
      OR LOWER(COALESCE(c.first_name,'')) LIKE $${params.length}
      OR LOWER(COALESCE(c.last_name,'')) LIKE $${params.length}
    )`);
  }
  params.push(Math.max(1,Math.min(500,Number(limit)||300)));
  return (await q(`SELECT pr.id,pr.rating,pr.feedback,pr.approved,pr.created_at,
      pr.requested_materials,pr.requested_colours,pr.shopify_product_id,
      c.id customer_id,c.email,c.first_name,c.last_name,
      oi.product_title,oi.variant_title,oi.order_id,o.order_name
    FROM product_reviews pr
    LEFT JOIN customers c ON c.id=pr.customer_id
    LEFT JOIN order_items oi ON oi.id=pr.order_item_id
    LEFT JOIN orders o ON o.id=oi.order_id
    ${where.length?'WHERE '+where.join(' AND '):''}
    ORDER BY pr.created_at DESC,pr.id DESC
    LIMIT $${params.length}`,params)).rows;
}

export async function setReviewApproved(id,approved){
  const r=await q(`UPDATE product_reviews SET approved=$2 WHERE id=$1 RETURNING id,approved`,[Number(id),!!approved]);
  return r.rows[0]||null;
}

export async function reviewStats(){
  const summary=(await q(`SELECT
    COUNT(*)::int total,
    COUNT(*) FILTER (WHERE approved=TRUE)::int approved,
    COUNT(*) FILTER (WHERE approved=FALSE)::int hidden,
    COALESCE(ROUND(AVG(rating)::numeric,2),0)::numeric(4,2) avg_rating,
    COUNT(*) FILTER (WHERE rating=5)::int five,
    COUNT(*) FILTER (WHERE rating=4)::int four,
    COUNT(*) FILTER (WHERE rating=3)::int three,
    COUNT(*) FILTER (WHERE rating=2)::int two,
    COUNT(*) FILTER (WHERE rating=1)::int one
    FROM product_reviews`)).rows[0];

  const products=(await q(`SELECT pr.shopify_product_id,COALESCE(oi.product_title,'Unknown product') product_title,
      COUNT(*)::int review_count,COALESCE(ROUND(AVG(pr.rating)::numeric,2),0)::numeric(4,2) avg_rating
    FROM product_reviews pr
    LEFT JOIN order_items oi ON oi.id=pr.order_item_id
    GROUP BY pr.shopify_product_id,COALESCE(oi.product_title,'Unknown product')
    ORDER BY review_count DESC,avg_rating DESC
    LIMIT 50`)).rows;

  const materialSuggestions=(await q(`SELECT requested_materials value,COUNT(*)::int mentions
    FROM product_reviews
    WHERE requested_materials IS NOT NULL AND BTRIM(requested_materials)<>''
    GROUP BY requested_materials
    ORDER BY mentions DESC,requested_materials ASC
    LIMIT 50`)).rows;

  const colourSuggestions=(await q(`SELECT requested_colours value,COUNT(*)::int mentions
    FROM product_reviews
    WHERE requested_colours IS NOT NULL AND BTRIM(requested_colours)<>''
    GROUP BY requested_colours
    ORDER BY mentions DESC,requested_colours ASC
    LIMIT 50`)).rows;

  return {summary,products,materialSuggestions,colourSuggestions};
}
