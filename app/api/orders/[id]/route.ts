import { NextResponse } from 'next/server';
import supabase from '@/lib/supabase';
import { route, parseJson } from '@/lib/api/handler';
import { HttpError, notFound } from '@/lib/api/errors';
import { requireUser, uid } from '@/lib/auth/require';
import { orderIdParamSchema, updateOrderStatusSchema } from '@/lib/validation/orders';

const ORDER_SELECT = `
  *,
  buyer:users!orders_buyer_id_fkey (id, name, phone_number),
  seller:users!orders_seller_id_fkey (id, name, phone_number),
  product:products (id, name, category, photos)
`;

// PUT - change order status. The SQL function enforces party membership, transitions and restock.
export const PUT = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireUser();
  const me = uid(session);
  const { id } = orderIdParamSchema.parse(await ctx.params);
  const { status } = await parseJson(req, updateOrderStatusSchema);

  const { error: rpcError } = await supabase.rpc('update_order_status', {
    p_order_id: id,
    p_actor_id: me,
    p_status: status,
  } as never);

  if (rpcError) {
    const msg = rpcError.message ?? '';
    // Non-parties get 404 so order ids can't be probed.
    if (msg.includes('order_not_found') || msg.includes('order_forbidden')) throw notFound('Order');
    if (msg.includes('invalid_transition')) throw new HttpError(409, 'This status change is not allowed');
    console.error('[orders] update_order_status failed', rpcError);
    throw new HttpError(500, 'Failed to update order');
  }

  const { data: order, error } = await supabase.from('orders').select(ORDER_SELECT).eq('id', id).single();
  if (error) {
    console.error('[orders] reload after update failed', error);
    throw new HttpError(500, 'Order updated but could not be reloaded');
  }

  return NextResponse.json({ success: true, order, message: `Order ${status} successfully` });
});
