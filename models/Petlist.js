// models/petlist.js

const mongoose = require('mongoose');
const { Schema } = mongoose;

const ConsultationHistorySchema = new Schema({
  reservation: {
    type: Schema.Types.ObjectId,
    ref: 'Reservation',
    required: true
  },
  consultation: {
    type: Schema.Types.ObjectId,
    ref: 'Consultation',
    required: true
  },
  addedAt: { type: Date, default: Date.now }
}, { _id: false });

const PetListSchema = new Schema({
  owner:       { type: Schema.Types.ObjectId, ref: 'User',    required: true },
  petName:     { type: String,                        required: true },
  reservation: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
  addedAt:     { type: Date,                         default: Date.now },
  consultationHistory: [ ConsultationHistorySchema ]
}, { timestamps: true });

module.exports = mongoose.model('PetList', PetListSchema);
