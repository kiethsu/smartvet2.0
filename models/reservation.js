const mongoose = require('mongoose');

/**
 * Each Reservation represents a single appointment/consultation event.
 * 
 * - consultationNotes, medications[]: The doctor's notes and prescribed meds
 *   for THIS reservation.
 * - petAdded: Tracks whether the pet data has been "added/updated" in the system,
 *   so you can hide it from the Ongoing list once done.
 */
const ReservationSchema = new mongoose.Schema(
  {
    // The user (owner) who booked this reservation
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ownerName: { type: String, required: true },

    // Pet info stored inline, plus an optional petId link if that pet is in your Pet collection
    pets: [
      {
        petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet' },
        petName: String,
      },
    ],

    service: { type: String, required: true },

    // Date & time for the appointment
    date: { type: Date, required: true },
    time: { type: String, required: true },

    // Owner concerns / reason for visit
    concerns: { type: String },

    // Reservation status (e.g. 'Pending', 'Approved', 'Done', etc.)
    status: { type: String, default: 'Pending' },

    // Assigned doctor
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Optional contact info
    address: { type: String, default: "" },
    phone: { type: String, default: "" },

    // === Consultation fields ===
    // The doctor can fill these out once the appointment is complete
    consultationNotes: { type: String, default: "" },
    medications: [
      { 
        medicationName: { type: String },
        dosage: { type: String },
        frequency: { type: String },
        adminTime: { type: String },
        additionalInstructions: { type: String },
        quantity: { type: String }  // New field added for medication quantity
      }
    ],

    // Follow-up schedule (if any)
    schedule: {
      scheduleDate: { type: Date },
      scheduleDetails: { type: String }
    },

    // Flag to indicate if the pet was "added/updated" in the system from this consultation
    petAdded: { type: Boolean, default: false },

    // Timestamp when the reservation was canceled (if applicable)
    canceledAt: { type: Date }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Reservation', ReservationSchema);
