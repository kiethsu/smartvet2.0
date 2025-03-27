// consultation.js

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const MedicationSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Inventory' },
  name: { type: String },
  dosage: { type: String },
  remarks: { type: String },
  quantity: { type: Number }
}, { _id: false });

const ConsultationSchema = new Schema({
  // Reference to the reservation for which the consultation is being done
  reservation: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
  // Consultation details
  consultationNotes: { type: String },
  // Capture additional details such as physical exam data, diagnosis, services, etc.
  physicalExam: {
    weight: { type: String },
    temperature: { type: String },
    observations: { type: String }
  },
  diagnosis: { type: String },
  // Services details with an optional file field
  services: [{
    category: { type: String },
    serviceName: { type: String },
    details: { type: String },
    file: { type: String } // Stores file path or URL
  }],
  // Medications prescribed during the consultation
  medications: [MedicationSchema],
  // Additional notes if any
  notes: { type: String },
  // New field to store confinement status (array of strings)
  confinementStatus: [{ type: String }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Consultation', ConsultationSchema);
