// models/reservation.js
const mongoose = require('mongoose');

const PetEntrySchema = new mongoose.Schema({
  petId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Pet' },
  petName: { type: String },

  // Per-pet schedule & flags
  schedule: {
    scheduleDate:    { type: Date },
    scheduleDetails: { type: String }
  },
  done:       { type: Boolean, default: false },
  hasConsult: { type: Boolean, default: false }
}, { _id: false });

const PetRequestSchema = new mongoose.Schema({
  petId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Pet' },
  petName:  { type: String },
  service:  { type: String },
  concerns: { type: String }
}, { _id: false });

const ReservationSchema = new mongoose.Schema({
  owner:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ownerName: { type: String, required: true },

  // Multi-pet support
  pets:        [PetEntrySchema],     // used by doctor-facing UI
  petRequests: [PetRequestSchema],   // requested service per pet (from booking)

  // Legacy reservation-level fields (kept for compatibility)
  service:   { type: String },
  concerns:  { type: String },

  // Booking slot used for capacity checks
  // date = calendar day; time = label like "8:00 AM"
  date:  { type: Date },
  time:  { type: String },

  // Doctor assignment & status
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, default: 'Pending' }, // Pending/Approved/Done/etc.

  // Optional reservation-level follow-up
  schedule: {
    scheduleDate:    { type: Date },
    scheduleDetails: { type: String }
  },

  isFollowUp: { type: Boolean, default: false },
  petAdded:   { type: Boolean, default: false },

  canceledAt: { type: Date },

  // Idempotency key to prevent duplicate submissions when users double-click submit
  // (Set this from the client and check server-side before creating a new doc)
  idemKey: { type: String }
}, { timestamps: true });

// Fast counting by slot for: date + time + active statuses
ReservationSchema.index({ date: 1, time: 1, status: 1 });

// Ensure only one reservation per idempotency key;
// sparse allows multiple docs with no idemKey at all.
ReservationSchema.index({ idemKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Reservation', ReservationSchema);
