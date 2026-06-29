import { connection } from "next/server";
import { Suspense } from "react";
import { AuthRoutePage } from "@/components/auth/auth-route-page";

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInRoute />
    </Suspense>
  );
}

async function SignInRoute() {
  await connection();
  return <AuthRoutePage mode="sign-in" />;
}
