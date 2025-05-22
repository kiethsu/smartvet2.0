// models/Payment.js
const mongoose = require('mongoose');

const lineItemSchema = new mongoose.Schema({
  name:       { type: String, required: true },   // e.g. medication name or service name
  quantity:   { type: Number, default: 1 },       // for products; for services you can leave 1
  unitPrice:  { type: Number, required: true },
  lineTotal:  { type: Number, required: true }    // quantity * unitPrice
});

const paymentSchema = new mongoose.Schema({
  reservation: { type: mongoose.Schema.Types.ObjectId, ref: 'Reservation', required: true },
  paidAt:      { type: Date, default: Date.now },
  amount:      { type: Number, required: true },  // grand total
  by:          { type: mongoose.Schema.Types.ObjectId, ref: 'User' },  // who marked paid
  products:    [ lineItemSchema ],   // medications
  services:    [ lineItemSchema ]    // services & fees
});

module.exports = mongoose.model('Payment', paymentSchema);
