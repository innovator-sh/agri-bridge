'use client';

import { useState } from 'react';
import { X, CreditCard, MapPin, User, Phone, Mail, CheckCircle } from 'lucide-react';

interface CartItem {
  id: number;
  name: string;
  seller_name: string;
  seller_id: number;
  price_single: number;
  price_multiple: number;
  cart_quantity: number;
  photos?: string[];
}

interface PaymentPortalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  onPaymentSuccess: () => void;
  /** Called when the cart changed but the portal stays open (partial failure). */
  onCartChanged?: () => void;
}

export default function PaymentPortal({ 
  isOpen, 
  onClose, 
  cartItems, 
  onPaymentSuccess,
  onCartChanged
}: PaymentPortalProps) {
  const [step, setStep] = useState(1); // 1: Details, 2: Payment, 3: Success
  const [loading, setLoading] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    pincode: '',
    notes: '',
    paymentMethod: 'card'
  });

  if (!isOpen) return null;

  // Calculate totals
  const calculateItemTotal = (item: CartItem) => {
    const price = item.cart_quantity >= 10 ? item.price_multiple : item.price_single;
    return price * item.cart_quantity;
  };

  const subtotal = cartItems.reduce((sum, item) => sum + calculateItemTotal(item), 0);
  const deliveryFee = 50;
  const total = subtotal + deliveryFee;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleNextStep = () => {
    if (step === 1) {
      // Validate form
      if (!formData.fullName || !formData.email || !formData.phone || !formData.address) {
        alert('Please fill in all required fields');
        return;
      }
      setStep(2);
    }
  };

  const handlePayment = async () => {
    setLoading(true);
    setPaymentError('');

    try {
      // Process payment (simulate success for now)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Create one order per cart item, sequentially. The server computes prices
      // and identifies the buyer from the session.
      const placedProductIds: number[] = [];
      let failure = '';

      for (const item of cartItems) {
        try {
          const response = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              productId: item.id,
              quantity: item.cart_quantity,
              deliveryAddress: `${formData.address}, ${formData.city} - ${formData.pincode}`,
              notes: formData.notes
            })
          });

          if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            const reason = typeof result?.error === 'string' ? result.error : `status ${response.status}`;
            failure = `Could not place the order for "${item.name}" (${reason}).`;
            break;
          }
          placedProductIds.push(item.id);
        } catch (error) {
          console.error('Order creation error:', error);
          failure = `Could not place the order for "${item.name}". Please check your connection and try again.`;
          break;
        }
      }

      if (failure) {
        // Remove items that were already ordered so they are not ordered twice on retry
        for (const productId of placedProductIds) {
          try {
            await fetch('/api/cart', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ productId })
            });
          } catch (error) {
            console.error('Cart update error:', error);
          }
        }
        if (placedProductIds.length > 0) {
          failure += ` ${placedProductIds.length} other order(s) were placed successfully and removed from your cart.`;
          onCartChanged?.();
        }
        setPaymentError(failure);
        return;
      }

      // All orders placed: clear cart
      try {
        await fetch('/api/cart/clear', { method: 'POST' });
      } catch (error) {
        console.error('Cart clear error:', error);
      }

      setStep(3);
      onPaymentSuccess();

    } catch (error) {
      console.error('Payment error:', error);
      setPaymentError('Payment failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b">
          <h2 className="text-2xl font-bold text-gray-900">
            {step === 1 ? 'Delivery Details' : step === 2 ? 'Payment' : 'Order Confirmed!'}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6">
          {/* Step 1: Delivery Details */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <User className="w-4 h-4 inline mr-1" />
                    Full Name *
                  </label>
                  <input
                    type="text"
                    name="fullName"
                    value={formData.fullName}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <Mail className="w-4 h-4 inline mr-1" />
                    Email *
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Phone className="w-4 h-4 inline mr-1" />
                  Phone Number *
                </label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <MapPin className="w-4 h-4 inline mr-1" />
                  Delivery Address *
                </label>
                <textarea
                  name="address"
                  value={formData.address}
                  onChange={handleInputChange}
                  rows={3}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
                  placeholder="House/Flat No, Street, Area"
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">City *</label>
                  <input
                    type="text"
                    name="city"
                    value={formData.city}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">PIN Code *</label>
                  <input
                    type="text"
                    name="pincode"
                    value={formData.pincode}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Special Instructions</label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleInputChange}
                  rows={2}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
                  placeholder="Any special delivery instructions..."
                />
              </div>

              {/* Order Summary */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="font-semibold text-gray-900 mb-3">Order Summary</h3>
                <div className="space-y-2">
                  {cartItems.map(item => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span>{item.name} × {item.cart_quantity}kg</span>
                      <span>₹{calculateItemTotal(item)}</span>
                    </div>
                  ))}
                  <div className="border-t pt-2 mt-2">
                    <div className="flex justify-between text-sm">
                      <span>Subtotal</span>
                      <span>₹{subtotal}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Delivery Fee</span>
                      <span>₹{deliveryFee}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-lg border-t pt-2 mt-2">
                      <span>Total</span>
                      <span>₹{total}</span>
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleNextStep}
                className="w-full bg-blue-600 text-white py-3 px-6 rounded-xl hover:bg-blue-700 transition-colors font-medium"
              >
                Continue to Payment
              </button>
            </div>
          )}

          {/* Step 2: Payment */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="font-semibold text-gray-900 mb-2">Payment Method</h3>
                <div className="space-y-3">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="card"
                      checked={formData.paymentMethod === 'card'}
                      onChange={handleInputChange}
                      className="mr-3"
                    />
                    <CreditCard className="w-5 h-5 mr-2" />
                    Credit/Debit Card
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="upi"
                      checked={formData.paymentMethod === 'upi'}
                      onChange={handleInputChange}
                      className="mr-3"
                    />
                    <span className="w-5 h-5 mr-2 text-center">💳</span>
                    UPI Payment
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="cod"
                      checked={formData.paymentMethod === 'cod'}
                      onChange={handleInputChange}
                      className="mr-3"
                    />
                    <span className="w-5 h-5 mr-2 text-center">💰</span>
                    Cash on Delivery
                  </label>
                </div>
              </div>

              <div className="bg-blue-50 rounded-xl p-4">
                <h3 className="font-semibold text-blue-900 mb-2">Total Amount: ₹{total}</h3>
                <p className="text-sm text-blue-700">
                  Your order will be processed immediately after payment confirmation.
                </p>
              </div>

              {paymentError && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm" role="alert">
                  {paymentError}
                </div>
              )}

              <div className="flex gap-4">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 bg-gray-100 text-gray-700 py-3 px-6 rounded-xl hover:bg-gray-200 transition-colors font-medium"
                >
                  Back
                </button>
                <button
                  onClick={handlePayment}
                  disabled={loading}
                  className="flex-1 bg-green-600 text-white py-3 px-6 rounded-xl hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  {loading ? 'Processing...' : `Pay ₹${total}`}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Success */}
          {step === 3 && (
            <div className="text-center space-y-6">
              <CheckCircle className="w-16 h-16 text-green-600 mx-auto" />
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Payment Successful!</h3>
                <p className="text-gray-600">
                  Your order has been placed successfully. You will receive a confirmation email shortly.
                </p>
              </div>
              <div className="bg-green-50 rounded-xl p-4">
                <p className="text-green-800 font-medium">Order Total: ₹{total}</p>
                <p className="text-sm text-green-600 mt-1">
                  Estimated delivery: 2-3 business days
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-full bg-blue-600 text-white py-3 px-6 rounded-xl hover:bg-blue-700 transition-colors font-medium"
              >
                Continue Shopping
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}