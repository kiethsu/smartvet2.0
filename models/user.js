// models/user.js
const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  username:   { type: String, required: true, unique: true },
  email:      { type: String, required: true, unique: true },
  password:   { type: String, required: true },
  verified:   { type: Boolean, default: false },
  role:       { type: String, enum: ["Admin", "Doctor", "HR", "Customer"], default: "Customer" },
  profilePic: { type: String },
  address:    { type: String },
  cellphone:  { type: String },
  otpEnabled: { type: Boolean, default: false }  // NEW FIELD
});

module.exports = mongoose.model("User", UserSchema);
