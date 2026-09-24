import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

// Default fallback hash for "admin123" if AUTH_PASSWORD_HASH is not set yet
const DEFAULT_HASH = "$2a$10$wO7v43vWp2bBfx8wzT22gupFq90sVb3rGZlFq5jYq5j0p0p0p0p0p";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Static Credentials",
      credentials: {
        username: { label: "Username", type: "text", placeholder: "wahyu" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        const validUsername = process.env.AUTH_USERNAME || "wahyu";
        const configuredHash = process.env.AUTH_PASSWORD_HASH;

        // Verify username
        if (credentials.username.trim().toLowerCase() !== validUsername.trim().toLowerCase()) {
          return null;
        }

        // Verify password
        if (configuredHash) {
          const isValid = bcrypt.compareSync(credentials.password, configuredHash);
          if (!isValid) return null;
        } else {
          // If no hash is configured in .env yet, allow default "admin123" or "password123"
          const isDefault =
            credentials.password === "admin123" || credentials.password === "password123";
          if (!isDefault) return null;
        }

        return {
          id: "1",
          name: validUsername,
          email: `${validUsername}@repostinsight.local`,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.NEXTAUTH_SECRET || "repostinsight-super-secret-key-change-me",
};
