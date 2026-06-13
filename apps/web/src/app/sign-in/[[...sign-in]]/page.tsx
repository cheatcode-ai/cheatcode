import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";

export default function SignInPage() {
  return (
    <main className="grid min-h-screen place-items-center">
      <Suspense fallback={<div className="h-[28rem] w-[25rem] rounded-md border" />}>
        <SignIn />
      </Suspense>
    </main>
  );
}
