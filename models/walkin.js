const mongoose = require('mongoose');

const WalkInSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ownerName: { type: String, required: true },
  petName: { type: String, required: true },
  species: { type: String, default: "Unknown" },
  birthday: { type: Date },
  sex: { type: String },
  disease: { type: String },
  breed: { type: String },
  cellphone: { type: String },
  address: { type: String },
  service: { type: String, required: true },
  concerns: { type: String },
  date: { type: Date, required: true },
  time: { type: String, required: true },
  // Optionally reference the originating reservation if needed:
  reservation: { type: mongoose.Schema.Types.ObjectId, ref: 'Reservation' }
}, { timestamps: true });

module.exports = mongoose.model('WalkIn', WalkInSchema);
