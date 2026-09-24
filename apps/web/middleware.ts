import { withAuth } from "next-auth/middleware";

export default withAuth({
  secret: process.env.NEXTAUTH_SECRET || "repostinsight-super-secret-key-change-me",
  pages: {
    signIn: "/login",
  },
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/chat/:path*",
    "/settings/:path*",
  ],
};
