const express = require("express");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

// ==========================================
// ENVIRONMENT VARIABLES
// ==========================================

const requiredEnvVars = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "JWT_SECRET",
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD"
];

for (const varName of requiredEnvVars) {
  if (!process.env[varName] || process.env[varName].trim() === "") {
    throw new Error(
      "Missing required environment variable: " + varName
    );
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const jwtSecret = process.env.JWT_SECRET;

const supabase = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

// ==========================================
// EXPRESS APP
// ==========================================

const app = express();

app.use(express.json());
app.use(cookieParser());

// Serve files from public/
app.use(express.static("public"));

// ==========================================
// AUTHENTICATION
// ==========================================

function requireAdminAuth(req, res, next) {
  const token = req.cookies ? req.cookies.token : null;

  if (!token) {
    return res.status(401).json({
      error: "Unauthorized: Missing authentication token"
    });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.admin = decoded;
    next();
  } catch (err) {
    console.error("JWT verification failed: " + err.message);

    return res.status(401).json({
      error: "Unauthorized: Invalid or expired authentication token"
    });
  }
}

// ==========================================
// HELPERS
// ==========================================

function generateReference() {
  const hexPart = crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase();

  return "BK-" + hexPart;
}

// ==========================================
// API ROUTER
// ==========================================

const apiRouter = express.Router();

// ==========================================
// PUBLIC ROUTES
// ==========================================

// GET /api/services
apiRouter.get("/services", async (req, res) => {
  try {
    const { data: services, error } = await supabase
      .from("services")
      .select("id, name, description, price, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });

     if (error) {
        console.error("SUPABASE SERVICES ERROR:");
        console.error(error);

    return res.status(500).json({
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
         });
    }

    return res.status(200).json(services);
  } catch (err) {
    console.error(
      "Unexpected error in GET /api/services:",
      err
    );

    return res.status(500).json({
      error: "Internal server error"
    });
  }
});

// ==========================================
// POST /api/bookings
// ==========================================

apiRouter.post("/bookings", async (req, res) => {
  try {
    const {
      service_id,
      name,
      contact,
      email,
      booking_date,
      booking_time,
      guests,
      notes
    } = req.body;

    // --------------------------------------
    // REQUIRED FIELDS
    // --------------------------------------

    if (
      !service_id ||
      !name ||
      !contact ||
      !email ||
      !booking_date ||
      !booking_time ||
      guests === undefined ||
      guests === null
    ) {
      return res.status(400).json({
        error:
          "Missing required fields: service_id, name, contact, email, booking_date, booking_time, guests"
      });
    }

    // --------------------------------------
    // CLEAN INPUT
    // --------------------------------------

    const trimmedName = String(name).trim();
    const trimmedContact = String(contact).trim();
    const trimmedEmail = String(email).trim();
    const trimmedDate = String(booking_date).trim();
    const trimmedTime = String(booking_time).trim();
    const trimmedNotes =
      notes && String(notes).trim()
        ? String(notes).trim()
        : null;

    if (
      !trimmedName ||
      !trimmedContact ||
      !trimmedEmail ||
      !trimmedDate ||
      !trimmedTime
    ) {
      return res.status(400).json({
        error: "Fields cannot be blank"
      });
    }

    // --------------------------------------
    // EMAIL VALIDATION
    // --------------------------------------

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(trimmedEmail)) {
      return res.status(400).json({
        error: "Invalid email address format"
      });
    }

    // --------------------------------------
    // GUEST VALIDATION
    // --------------------------------------

    const parsedGuests = parseInt(guests, 10);

    if (isNaN(parsedGuests) || parsedGuests < 1) {
      return res.status(400).json({
        error: "Guests must be a number of at least 1"
      });
    }

    // --------------------------------------
    // DATE VALIDATION
    // --------------------------------------

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (!dateRegex.test(trimmedDate)) {
      return res.status(400).json({
        error: "Invalid date format. Expected YYYY-MM-DD"
      });
    }

    let todayStr;

    try {
      todayStr = new Date().toLocaleDateString(
        "en-CA",
        {
          timeZone: "Asia/Manila"
        }
      );
    } catch (e) {
      todayStr = new Date()
        .toISOString()
        .split("T")[0];
    }

    if (trimmedDate < todayStr) {
      return res.status(400).json({
        error: "Booking date cannot be in the past"
      });
    }

    // --------------------------------------
    // TIME VALIDATION
    // --------------------------------------

    const timeParts = trimmedTime.split(":");

    if (timeParts.length < 2) {
      return res.status(400).json({
        error: "Invalid time format. Expected HH:MM"
      });
    }

    const hour = parseInt(timeParts[0], 10);
    const minute = parseInt(timeParts[1], 10);

    if (
      isNaN(hour) ||
      isNaN(minute) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      return res.status(400).json({
        error: "Invalid time values"
      });
    }

    const totalMinutes = hour * 60 + minute;
    const openingMinutes = 7 * 60;
    const closingMinutes = 17 * 60;

    if (
      totalMinutes < openingMinutes ||
      totalMinutes > closingMinutes
    ) {
      return res.status(400).json({
        error: "Booking time must be between 07:00 and 17:00"
      });
    }

    // --------------------------------------
    // CHECK SERVICE
    // --------------------------------------

    const {
      data: service,
      error: serviceError
    } = await supabase
      .from("services")
      .select("id, name, is_active")
      .eq("id", service_id)
      .single();

    if (serviceError) {
      console.error(
        "Error checking service:",
        serviceError
      );

      return res.status(500).json({
        error: "Failed to check selected service"
      });
    }

    if (!service) {
      return res.status(400).json({
        error: "Selected service does not exist"
      });
    }

    if (!service.is_active) {
      return res.status(400).json({
        error: "Selected service is currently unavailable"
      });
    }

    // --------------------------------------
    // SAVE BOOKING
    // --------------------------------------

    let savedBooking = null;
    let reference = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      reference = generateReference();

      const bookingData = {
        reference: reference,
        service_id: service_id,
        name: trimmedName,
        contact: trimmedContact,
        email: trimmedEmail,
        booking_date: trimmedDate,
        booking_time: trimmedTime,
        guests: parsedGuests,
        notes: trimmedNotes,
        status: "pending"
      };

      console.log(
        "Attempting to save booking:",
        bookingData
      );

      const {
        data,
        error: insertError
      } = await supabase
        .from("bookings")
        .insert([bookingData])
        .select("*")
        .single();

      if (!insertError) {
        savedBooking = data;
        break;
      }

      console.error(
        "Supabase booking insert error:",
        insertError
      );

      // Duplicate reference → try again
      if (insertError.code === "23505") {
        continue;
      }

      return res.status(500).json({
        error:
          insertError.message ||
          "Failed to create booking"
      });
    }

    // --------------------------------------
    // CHECK IF BOOKING WAS SAVED
    // --------------------------------------

    if (!savedBooking) {
      return res.status(500).json({
        error:
          "Failed to generate unique booking reference"
      });
    }

    // --------------------------------------
    // SUCCESS
    // --------------------------------------

    console.log(
      "Booking successfully saved:",
      savedBooking
    );

    return res.status(201).json({
      success: true,
      reference: savedBooking.reference,
      booking: {
        ...savedBooking,
        service_name: service.name
      }
    });

  } catch (err) {
    console.error(
      "Unexpected error in POST /api/bookings:",
      err
    );

    return res.status(500).json({
      error: err.message || "Internal server error"
    });
  }
});

// ==========================================
// GET BOOKING BY REFERENCE
// ==========================================

apiRouter.get(
  "/bookings/:reference",
  async (req, res) => {
    try {
      const reference = String(
        req.params.reference
      ).trim();

      const {
        data: booking,
        error
      } = await supabase
        .from("bookings")
        .select(
          "*, services(name, price, description)"
        )
        .eq("reference", reference)
        .single();

      if (error || !booking) {
        return res.status(404).json({
          error: "Booking not found"
        });
      }

      return res.status(200).json({
        ...booking,
        service_name: booking.services
          ? booking.services.name
          : null
      });

    } catch (err) {
      console.error(
        "Unexpected error in GET /api/bookings/:reference:",
        err
      );

      return res.status(500).json({
        error: "Internal server error"
      });
    }
  }
);

// ==========================================
// ADMIN LOGIN
// ==========================================

apiRouter.post("/admin/login", async (req, res) => {
  console.log("===== ADMIN LOGIN ROUTE CALLED =====");

  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: "Username and password are required"
      });
    }

    const enteredUsername = String(username).trim();
    const enteredPassword = String(password);

    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;

    console.log("Login attempt:");
    console.log("Entered username:", enteredUsername);
    console.log("Expected username:", adminUsername);

    // Check username first
    if (enteredUsername !== adminUsername) {
      console.log("Username does not match.");
      return res.status(401).json({
        error: "Invalid username or password"
      });
    }

    // Hash the .env password and compare using bcrypt
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    const isMatch = await bcrypt.compare(
      enteredPassword,
      passwordHash
    );

    console.log("Password matches:", isMatch);

    if (!isMatch) {
      return res.status(401).json({
        error: "Invalid username or password"
      });
    }

    // Create JWT
    const token = jwt.sign(
      {
        username: adminUsername,
        role: "admin"
      },
      jwtSecret,
      {
        expiresIn: "1d"
      }
    );

    // Store token in cookie
    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000
    });

    console.log("Admin login successful.");

    return res.status(200).json({
      success: true,
      message: "Login successful",
      admin: {
        username: adminUsername,
        role: "admin"
      }
    });

  } catch (err) {
    console.error(
      "Unexpected error in POST /api/admin/login:",
      err
    );

    return res.status(500).json({
      error: "Internal server error"
    });
  }
});

// ==========================================
// ADMIN LOGOUT
// ==========================================

apiRouter.post(
  "/admin/logout",
  (req, res) => {
    res.clearCookie("token", {
      httpOnly: true,
      sameSite: "lax",
      secure:
        process.env.NODE_ENV === "production"
    });

    return res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });
  }
);

// ==========================================
// ADMIN SESSION
// ==========================================

apiRouter.get(
  "/admin/me",
  requireAdminAuth,
  (req, res) => {
    return res.status(200).json({
      authenticated: true,
      admin: req.admin
    });
  }
);

// ==========================================
// ADMIN - GET BOOKINGS
// ==========================================

apiRouter.get(
  "/admin/bookings",
  requireAdminAuth,
  async (req, res) => {
    try {
      const {
        data: bookings,
        error
      } = await supabase
        .from("bookings")
        .select(
          "*, services(name, price)"
        )
        .order(
          "created_at",
          {
            ascending: false
          }
        );

      if (error) {
        console.error(
          "Error fetching admin bookings:",
          error
        );

        return res.status(500).json({
          error:
            "Failed to fetch bookings"
        });
      }

      const formattedBookings =
        bookings.map((item) => ({
          ...item,
          service_name: item.services
            ? item.services.name
            : null
        }));

      return res.status(200).json(
        formattedBookings
      );

    } catch (err) {
      console.error(
        "Unexpected error in GET /api/admin/bookings:",
        err
      );

      return res.status(500).json({
        error: "Internal server error"
      });
    }
  }
);

// ==========================================
// ADMIN - CONFIRM BOOKING
// ==========================================

apiRouter.patch(
  "/admin/bookings/:id/confirm",
  requireAdminAuth,
  async (req, res) => {
    try {
      const { id } = req.params;

      const {
        data: updatedBooking,
        error
      } = await supabase
        .from("bookings")
        .update({
          status: "confirmed"
        })
        .eq("id", id)
        .select(
          "*, services(name, price)"
        )
        .single();

      if (error || !updatedBooking) {
        console.error(
          "Error confirming booking " +
            id +
            ": " +
            (error
              ? error.message
              : "Not found")
        );

        return res.status(
          error ? 500 : 404
        ).json({
          error: error
            ? "Failed to confirm booking"
            : "Booking not found"
        });
      }

      return res.status(200).json({
        success: true,
        message:
          "Booking confirmed successfully",
        booking: {
          ...updatedBooking,
          service_name:
            updatedBooking.services
              ? updatedBooking.services.name
              : null
        }
      });

    } catch (err) {
      console.error(
        "Unexpected error in PATCH /api/admin/bookings/:id/confirm:",
        err
      );

      return res.status(500).json({
        error: "Internal server error"
      });
    }
  }
);

// ==========================================
// ADMIN - CANCEL BOOKING
// ==========================================

apiRouter.patch(
  "/admin/bookings/:id/cancel",
  requireAdminAuth,
  async (req, res) => {
    try {
      const { id } = req.params;

      const {
        data: updatedBooking,
        error
      } = await supabase
        .from("bookings")
        .update({
          status: "cancelled"
        })
        .eq("id", id)
        .select(
          "*, services(name, price)"
        )
        .single();

      if (error || !updatedBooking) {
        console.error(
          "Error cancelling booking " +
            id +
            ": " +
            (error
              ? error.message
              : "Not found")
        );

        return res.status(
          error ? 500 : 404
        ).json({
          error: error
            ? "Failed to cancel booking"
            : "Booking not found"
        });
      }

      return res.status(200).json({
        success: true,
        message:
          "Booking cancelled successfully",
        booking: {
          ...updatedBooking,
          service_name:
            updatedBooking.services
              ? updatedBooking.services.name
              : null
        }
      });

    } catch (err) {
      console.error(
        "Unexpected error in PATCH /api/admin/bookings/:id/cancel:",
        err
      );

      return res.status(500).json({
        error: "Internal server error"
      });
    }
  }
);

// ==========================================
// ADMIN - DELETE BOOKING
// ==========================================

apiRouter.delete(
  "/admin/bookings/:id",
  requireAdminAuth,
  async (req, res) => {
    try {
      const { id } = req.params;

      const {
        data: deletedBooking,
        error
      } = await supabase
        .from("bookings")
        .delete()
        .eq("id", id)
        .select("id")
        .single();

      if (error || !deletedBooking) {
        console.error(
          "Error deleting booking " +
            id +
            ": " +
            (error
              ? error.message
              : "Not found")
        );

        return res.status(
          error ? 500 : 404
        ).json({
          error: error
            ? "Failed to delete booking"
            : "Booking not found"
        });
      }

      return res.status(200).json({
        success: true,
        message:
          "Booking deleted successfully"
      });

    } catch (err) {
      console.error(
        "Unexpected error in DELETE /api/admin/bookings/:id:",
        err
      );

      return res.status(500).json({
        error: "Internal server error"
      });
    }
  }
);

// ==========================================
// MOUNT API ROUTER
// ==========================================

app.use("/api", apiRouter);
app.use("/", apiRouter);

// ==========================================
// START SERVER
// ==========================================

if (require.main === module) {
  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log(
      "Coffee Shop Booking API server running on port " +
        PORT
    );
  });
}

module.exports = app;