"use client";
import { PaymentRequiredDialog } from "@/components/billing/payment-required-dialog"
import { AuthModal } from "@/components/auth/auth-modal"

export const ModalProviders = () => {
  return (
    <>
      <PaymentRequiredDialog />
      <AuthModal />
    </>
  )
}
