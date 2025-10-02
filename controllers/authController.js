// controllers/authController.js
const nodemailer = require("nodemailer");
const User = require("../models/user");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const Joi = require("joi");

// -------------------------
// In-memory stores (demo)
// -------------------------
let otpStore = {};           // registration: { [email]: { code, exp } }
let resetOtpStore = {};      // password reset: { [email]: { code, exp } }
let adminOtpStore = {};      // admin login: { [email]: { code, exp } }
let otpCooldown = {};        // registration cooldown: { [email]: lastSentMs }
let resetOtpCooldown = {};   // reset cooldown: { [email]: lastSentMs }

const loginAttempts = {};    // { [email]: { count, lockoutStart: Date|null } }
const FAILED_ATTEMPTS_THRESHOLD = 3;
const LOCKOUT_DURATION = 5 * 60 * 1000; // 5 minutes

// OTP settings
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_LEN = 6;

// -------------------------
// Nodemailer (Brevo SMTP)
// -------------------------
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASS,
  },
  // fail fast instead of hanging forever
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
});

// helper: sendMail with hard timeout guard
async function sendMailWithTimeout(mailOptions, timeoutMs = 12000) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("SMTP timeout")), timeoutMs)
  );
  // nodemailer returns a promise if no callback is supplied
  return Promise.race([transporter.sendMail(mailOptions), timeout]);
}

/**
 * validateCaptcha (kept for future use)
 */
async function validateCaptcha(captchaResponse) {
  const secretKey = process.env.GOOGLE_RECAPTCHA_SECRET;
  if (!captchaResponse || !secretKey) return true; // skip if not configured
  try {
    const response = await axios.post(
      `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${captchaResponse}`
    );
    return !!response.data.success;
  } catch (err) {
    console.error("reCAPTCHA validation error:", err);
    return false;
  }
}

// util: generate a 6-digit string OTP
function genOtp() {
  const n = Math.floor(Math.random() * 10 ** OTP_LEN)
    .toString()
    .padStart(OTP_LEN, "0");
  return n;
}

// -------------------------
// SEND OTP (Registration)
// -------------------------
exports.sendOTP = async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = (email || "").trim().toLowerCase();
  const ADMIN_EMAIL = "smartvetclinic17@gmail.com";

  try {
    // env guard
    if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASS) {
      return res.status(500).json({ message: "Email service not configured." });
    }

    if (normalizedEmail === ADMIN_EMAIL) {
      return res
        .status(400)
        .json({ message: "Admin email cannot be used for registration!" });
    }

    // cooldown
    const now = Date.now();
    const COOLDOWN_MS = 60 * 1000;
    const last = otpCooldown[normalizedEmail] || 0;
    if (now - last < COOLDOWN_MS) {
      const wait = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
      return res
        .status(429)
        .json({ message: `Please wait ${wait}s before requesting another OTP.` });
    }
    otpCooldown[normalizedEmail] = now;

    // already registered?
    const existingUser = await User.findOne({
      email: { $regex: `^${normalizedEmail}$`, $options: "i" },
    });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "This email is already registered! Please log in." });
    }

    // generate + store OTP with TTL
    const otp = genOtp();
    otpStore[normalizedEmail] = { code: otp, exp: now + OTP_TTL_MS };

    const mailOptions = {
      from: `"SmartVet" <dehe.marquez.au@phinmaed.com>`,
      to: normalizedEmail,
      subject: "Your OTP Verification Code",
      text: `Your OTP code is: ${otp}. It expires in 5 minutes.`,
    };

    await sendMailWithTimeout(mailOptions); // throws on timeout/fail
    return res.status(200).json({ message: "OTP sent. Check your email!" });
  } catch (error) {
    // let the user retry immediately
    delete otpCooldown[normalizedEmail];
    delete otpStore[normalizedEmail];
    console.error("Send OTP error:", error.message || error);
    return res
      .status(500)
      .json({ message: "Failed to send OTP. Please try again." });
  }
};

// -------------------------
// Verify OTP & Register
// -------------------------
exports.verifyOTPAndRegister = async (req, res) => {
  const { username, password, email, otp } = req.body;
  const normalizedEmail = (email || "").trim().toLowerCase();
  const normalizedUsername = (username || "").trim().toLowerCase();
  const ADMIN_EMAIL = "smartvetclinic17@gmail.com";

  if (normalizedEmail === ADMIN_EMAIL) {
    return res
      .status(400)
      .json({ message: "Admin email cannot be used for user registration!" });
  }

  const record = otpStore[normalizedEmail];
  if (!record || record.code !== String(otp) || Date.now() > record.exp) {
    return res.status(400).json({ message: "Invalid or expired OTP" });
  }

  try {
    const existingUser = await User.findOne({
      email: { $regex: `^${normalizedEmail}$`, $options: "i" },
    });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "This email is already registered! Please log in." });
    }

    const existingUsername = await User.findOne({
      username: { $regex: `^${normalizedUsername}$`, $options: "i" },
    });
    if (existingUsername) {
      return res
        .status(400)
        .json({ message: "This username is already taken! Please choose another one." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username: normalizedUsername,
      password: hashedPassword,
      email: normalizedEmail,
      verified: true,
    });
    await newUser.save();

    delete otpStore[normalizedEmail];

    res.status(200).json({ message: "Successfully registered!", success: true });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Registration failed" });
  }
};

// -------------------------
// Admin OTP helper (reusable)
// -------------------------
async function sendAdminOtpEmail(normalizedEmail) {
  // validate admin
  const user = await User.findOne({ email: normalizedEmail });
  if (!user || user.role !== "Admin") {
    const err = new Error("Admin account not found!");
    err.status = 400;
    throw err;
  }

  const otp = genOtp();
  adminOtpStore[normalizedEmail] = { code: otp, exp: Date.now() + OTP_TTL_MS };

  const mailOptions = {
    from: `"SmartVet" <dehe.marquez.au@phinmaed.com>`,
    to: normalizedEmail,
    subject: "Admin OTP Verification",
    text: `Your OTP for admin login is: ${otp}. It expires in 5 minutes.`,
  };

  await sendMailWithTimeout(mailOptions);
}

// -------------------------
// SEND OTP for Admin Login
// -------------------------
exports.sendAdminOTP = async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = (email || "").trim().toLowerCase();
  try {
    if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASS) {
      return res.status(500).json({ message: "Email service not configured." });
    }
    await sendAdminOtpEmail(normalizedEmail);
    return res
      .status(200)
      .json({ message: "Admin OTP sent. Check your email!" });
  } catch (error) {
    console.error("Error Sending Admin OTP:", error.message || error);
    const status = error.status || 500;
    return res
      .status(status)
      .json({ message: error.status ? error.message : "Failed to send OTP" });
  }
};

// -------------------------
// LOGIN (role-specific cookies)
// -------------------------
exports.login = async (req, res) => {
  const { email, password, captchaResponse } = req.body;
  const normalizedEmail = (email || "").trim().toLowerCase();

  if (!loginAttempts[normalizedEmail]) {
    loginAttempts[normalizedEmail] = { count: 0, lockoutStart: null };
  }
  const attempt = loginAttempts[normalizedEmail];
  const now = Date.now();

  // lockout window
  if (attempt.lockoutStart && now - attempt.lockoutStart < LOCKOUT_DURATION) {
    return res
      .status(429)
      .json({ message: "Too many failed attempts. Please try again in 5 minutes." });
  } else if (attempt.lockoutStart && now - attempt.lockoutStart >= LOCKOUT_DURATION) {
    attempt.count = 0;
    attempt.lockoutStart = null;
  }

  try {
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      attempt.count++;
      if (attempt.count >= FAILED_ATTEMPTS_THRESHOLD) attempt.lockoutStart = now;
      return res.status(400).json({ emailError: "Invalid Gmail" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      attempt.count++;
      if (attempt.count >= FAILED_ATTEMPTS_THRESHOLD) attempt.lockoutStart = now;
      return res.status(400).json({ passwordError: "Password did not match!" });
    }

    // reset attempts on success
    attempt.count = 0;
    attempt.lockoutStart = null;

    // Admin with OTP enabled → send OTP (mail send uses timeout, no hang)
    if (user.role === "Admin" && user.otpEnabled) {
      try {
        await sendAdminOtpEmail(normalizedEmail);
      } catch (e) {
        console.error("Admin OTP email error:", e.message || e);
        return res.status(500).json({ message: "Failed to send Admin OTP." });
      }
      return res
        .status(200)
        .json({ message: "Admin OTP sent. Check your email!", requireOTP: true });
    }

    // Issue tokens
    let redirectPath = "/customer-dashboard";
    if (user.role === "Doctor") redirectPath = "/doctor-dashboard";
    else if (user.role === "HR") redirectPath = "/hr-dashboard";
    else if (user.role === "Admin") redirectPath = "/admin-dashboard";

    const accessToken = jwt.sign(
      { userId: user._id, username: user.username, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    const refreshToken = jwt.sign(
      { userId: user._id, username: user.username, email: user.email, role: user.role },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    const isProd = process.env.NODE_ENV === "production";
    const accessCookieName = user.role.toLowerCase() + "_token";

    res.cookie(accessCookieName, accessToken, {
      httpOnly: true,
      maxAge: 60 * 60 * 1000,
      path: "/",
      sameSite: "lax",
      secure: isProd,
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
      sameSite: "lax",
      secure: isProd,
    });

    // fire-and-forget login notification (will not block response)
    (async () => {
      try {
        await sendMailWithTimeout({
          from: `"SmartVet" <dehe.marquez.au@phinmaed.com>`,
          to: normalizedEmail,
          subject: "Login Notification",
          text: `You have just logged in. If this wasn't you, please contact support immediately.`,
        });
      } catch (e) {
        console.error("Login notification email failed:", e.message || e);
      }
    })();

    return res
      .status(200)
      .json({ message: "Login successful!", redirect: redirectPath });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Login failed!" });
  }
};

// -------------------------
// VERIFY ADMIN OTP
// -------------------------
exports.verifyAdminOTP = async (req, res) => {
  const { email, otp } = req.body;
  const normalizedEmail = (email || "").trim().toLowerCase();

  const rec = adminOtpStore[normalizedEmail];
  if (!rec || rec.code !== String(otp) || Date.now() > rec.exp) {
    return res.status(400).json({ message: "Invalid or expired OTP" });
  }
  delete adminOtpStore[normalizedEmail];

  const user = await User.findOne({ email: normalizedEmail });
  if (!user) return res.status(400).json({ message: "User not found." });
  if (user.role !== "Admin")
    return res.status(403).json({ message: "Not an Admin user." });

  const accessToken = jwt.sign(
    { userId: user._id, username: user.username, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  const isProd = process.env.NODE_ENV === "production";
  res.cookie("admin_token", accessToken, {
    httpOnly: true,
    maxAge: 60 * 60 * 1000,
    path: "/",
    sameSite: "lax",
    secure: isProd,
  });

  return res.status(200).json({
    message: "OTP verified! You are now logged in as Admin. Redirecting...",
    redirect: "/admin-dashboard",
  });
};

// -------------------------
// Username & Email checks
// -------------------------
const usernameSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
});

exports.checkUsernameAvailability = async (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res
      .status(400)
      .json({ available: false, message: "Username is required!" });
  }

  const { error } = usernameSchema.validate({ username });
  if (error) {
    return res
      .status(400)
      .json({ available: false, message: error.details[0].message });
  }

  try {
    const normalizedUsername = username.trim().toLowerCase();
    const existingUser = await User.findOne({
      username: { $regex: `^${normalizedUsername}$`, $options: "i" },
    });
    if (existingUser) {
      return res
        .status(400)
        .json({ available: false, message: "Username is already taken!" });
    }
    res.status(200).json({ available: true, message: "Username is available!" });
  } catch (error) {
    console.error("Error checking username:", error);
    res
      .status(500)
      .json({ available: false, message: "Server error, try again later." });
  }
};

exports.checkEmailAvailability = async (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res
      .status(400)
      .json({ available: false, message: "Email is required!" });
  }
  try {
    const normalizedEmail = email.trim().toLowerCase();
    const ADMIN_EMAIL = "smartvetclinic17@gmail.com";
    if (normalizedEmail === ADMIN_EMAIL) {
      return res.status(400).json({
        available: false,
        message: "This email cannot be used for registration!",
      });
    }
    const existingUser = await User.findOne({
      email: { $regex: `^${normalizedEmail}$`, $options: "i" },
    });
    if (existingUser) {
      return res.status(400).json({
        available: false,
        message: "This email is already registered! Please log in.",
      });
    }
    res.status(200).json({ available: true, message: "Email is available!" });
  } catch (error) {
    console.error("Error checking email:", error);
    res
      .status(500)
      .json({ available: false, message: "Server error, try again later." });
  }
};

// -------------------------
// SEND OTP for Password Reset
// -------------------------
exports.sendResetOTP = async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = (email || "").trim().toLowerCase();

  if (!normalizedEmail.includes("@gmail.com")) {
    return res.status(400).json({
      message: "Invalid Gmail address! Please enter a valid @gmail.com email.",
    });
  }

  try {
    if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASS) {
      return res.status(500).json({ message: "Email service not configured." });
    }

    // ensure account exists
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(400).json({ message: "This email is not registered!" });
    }

    // cooldown
    const now = Date.now();
    const COOLDOWN_MS = 60 * 1000;
    const last = resetOtpCooldown[normalizedEmail] || 0;
    if (now - last < COOLDOWN_MS) {
      const wait = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
      return res
        .status(429)
        .json({ message: `Please wait ${wait}s before requesting another OTP.` });
    }
    resetOtpCooldown[normalizedEmail] = now;

    // generate + store with TTL
    const otp = genOtp();
    resetOtpStore[normalizedEmail] = { code: otp, exp: now + OTP_TTL_MS };

    const mailOptions = {
      from: `"SmartVet" <dehe.marquez.au@phinmaed.com>`,
      to: normalizedEmail,
      subject: "Password Reset OTP",
      text: `Your OTP for password reset is: ${otp}. It expires in 5 minutes.`,
    };

    await sendMailWithTimeout(mailOptions);
    return res.status(200).json({ message: "OTP sent. Check your email!" });
  } catch (error) {
    delete resetOtpCooldown[normalizedEmail];
    delete resetOtpStore[normalizedEmail];
    console.error("Error sending reset OTP:", error.message || error);
    return res.status(500).json({ message: "Failed to send OTP" });
  }
};

// -------------------------
// VERIFY RESET OTP
// -------------------------
exports.verifyResetOTP = async (req, res) => {
  const { email, otp } = req.body;
  const normalizedEmail = (email || "").trim().toLowerCase();
  const rec = resetOtpStore[normalizedEmail];
  if (!rec || rec.code !== String(otp) || Date.now() > rec.exp) {
    return res.status(400).json({ message: "Invalid or expired OTP" });
  }
  delete resetOtpStore[normalizedEmail];
  res.status(200).json({ message: "OTP verified! You can now reset your password." });
};

// -------------------------
// RESET PASSWORD
// -------------------------
exports.resetPassword = async (req, res) => {
  const { email, newPassword } = req.body;
  try {
    const user = await User.findOne({ email: (email || "").trim().toLowerCase() });
    if (!user) {
      return res.status(400).json({ message: "User not found!" });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();
    res
      .status(200)
      .json({ message: "Password reset successfully! You can now log in." });
  } catch (error) {
    console.error("Error resetting password:", error);
    res.status(500).json({ message: "Password reset failed." });
  }
};

// -------------------------
// REFRESH TOKEN (unified)
// -------------------------
exports.refreshToken = async (req, res) => {
  const refreshToken = req.cookies["refreshToken"];
  if (!refreshToken) {
    return res.status(401).json({ message: "No refresh token provided" });
  }
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const newAccessToken = jwt.sign(
      {
        userId: decoded.userId,
        username: decoded.username,
        email: decoded.email,
        role: decoded.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    const cookieName = decoded.role.toLowerCase() + "_token";
    const isProd = process.env.NODE_ENV === "production";
    res.cookie(cookieName, newAccessToken, {
      httpOnly: true,
      maxAge: 60 * 60 * 1000,
      path: "/",
      sameSite: "lax",
      secure: isProd,
    });
    res.status(200).json({ message: "Access token refreshed" });
  } catch (error) {
    console.error("Refresh token error:", error);
    return res.status(401).json({ message: "Invalid refresh token" });
  }
};
