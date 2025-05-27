// models/Payment.js
const mongoose = require('mongoose');

const lineItemSchema = new mongoose.Schema({
  name:       { type: String, required: true },   // e.g. medication name or service name
  quantity:   { type: Number, default: 1 },       // for products; for services you can leave 1
  unitPrice:  { type: Number, required: true },
  lineTotal:  { type: Number, required: true }    // quantity * unitPrice
});

const paymentSchema = new mongoose.Schema({
  reservation: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Reservation',
    required: true 
  },
  // ←–– NEW: who the payment is for (the customer)
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  paidAt:      { type: Date, default: Date.now },
  amount:      { type: Number, required: true },  // grand total
  by:          { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true    // the HR user who marked it paid
  },
  products:    [ lineItemSchema ],   // medications
  services:    [ lineItemSchema ]    // services & fees
}, {
  timestamps: true
});

module.exports = mongoose.model('Payment', paymentSchema);
