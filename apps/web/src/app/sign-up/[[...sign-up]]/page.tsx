import { connection } from "next/server";
import { Suspense } from "react";
import { AuthRoutePage } from "@/components/auth/auth-route-page";

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpRoute />
    </Suspense>
  );
}

async function SignUpRoute() {
  await connection();
  return <AuthRoutePage mode="sign-up" />;
}
