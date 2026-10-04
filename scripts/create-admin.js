const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;

function validateEnvironment() {
  const missingVariables = [];

  if (!supabaseUrl || supabaseUrl.trim() === "") {
    missingVariables.push("SUPABASE_URL");
  }
  if (!supabaseServiceRoleKey || supabaseServiceRoleKey.trim() === "") {
    missingVariables.push("SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!adminUsername || adminUsername.trim() === "") {
    missingVariables.push("ADMIN_USERNAME");
  }
  if (!adminPassword || adminPassword.trim() === "") {
    missingVariables.push("ADMIN_PASSWORD");
  }

  if (missingVariables.length > 0) {
    console.error("Error: Missing required environment variable(s) in .env: " + missingVariables.join(", "));
    console.error("Please configure all required variables before running this script.");
    process.exit(1);
  }
}

async function createAdmin() {
  validateEnvironment();

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  try {
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(adminPassword, saltRounds);

    const { data, error } = await supabase
      .from("admins")
      .insert([
        {
          username: adminUsername,
          password_hash: passwordHash
        }
      ])
      .select("id, username, created_at");

    if (error) {
      if (error.code === "23505" || (error.message && error.message.indexOf("duplicate key") !== -1)) {
        console.error("Duplicate Admin: The username \"" + adminUsername + "\" already exists in the database.");
        console.error("Change ADMIN_USERNAME in your .env file or choose another username.");
        process.exit(1);
      }

      console.error("Database Error: Failed to insert admin user: " + error.message);
      process.exit(1);
    }

    console.log("Success: Admin user \"" + adminUsername + "\" has been created successfully.");
  } catch (err) {
    console.error("Unexpected Error: " + err.message);
    process.exit(1);
  }
}

createAdmin();
