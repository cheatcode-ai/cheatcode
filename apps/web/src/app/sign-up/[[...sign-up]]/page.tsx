import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";

export default function SignUpPage() {
  return (
    <main className="grid min-h-screen place-items-center">
      <Suspense fallback={<div className="h-[32rem] w-[25rem] rounded-md border" />}>
        <SignUp />
      </Suspense>
    </main>
  );
}
