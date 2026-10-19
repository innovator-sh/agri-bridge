import { NextResponse } from 'next/server';
import supabase from '@/lib/supabase';
import { route } from '@/lib/api/handler';
import { HttpError } from '@/lib/api/errors';
import { requireRole, uid } from '@/lib/auth/require';

// POST - clear the session user's cart (any body is ignored)
export const POST = route(async () => {
  const me = uid(await requireRole('buyer'));

  const { error } = await supabase.from('cart_items').delete().eq('user_id', me);
  if (error) {
    console.error('[cart] clear failed', error);
    throw new HttpError(500, 'Failed to clear cart');
  }

  return NextResponse.json({ success: true, message: 'Cart cleared successfully' });
});
