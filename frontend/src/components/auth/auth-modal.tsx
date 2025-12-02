import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { SignIn, SignUp } from '@clerk/nextjs';
import { useModal } from '@/hooks/use-modal-store';
import { dark } from '@clerk/themes';
import { X } from 'lucide-react';

export function AuthModal() {
  const { isOpen, type, onClose } = useModal();

  const isSignInModalOpen = isOpen && type === 'signIn';
  const isSignUpModalOpen = isOpen && type === 'signUp';
  const isAuthModalOpen = isSignInModalOpen || isSignUpModalOpen;

  return (
    <Dialog open={isAuthModalOpen} onOpenChange={onClose}>
       <DialogContent className="p-0 border-0 max-w-md !bg-[unset] [&>button]:hidden">
         <DialogTitle className="sr-only">
           {isSignInModalOpen ? 'Sign In' : 'Sign Up'}
         </DialogTitle>
         <div className="relative">
           {/* Custom close button */}
           <button
             onClick={onClose}
             className="absolute top-4 right-8 z-10 p-2 rounded-full bg-transparent hover:bg-white/10 text-white transition-colors"
             aria-label="Close"
           >
             <X className="h-5 w-5" />
           </button>

           {isSignInModalOpen && (
             <SignIn
               routing="hash"
               appearance={{
                 baseTheme: dark,
                 elements: {
                   rootBox: "mx-auto",
                   card: "shadow-none border-0"
                 }
               }}
             />
           )}
           {isSignUpModalOpen && (
             <SignUp
               routing="hash"
               appearance={{
                 baseTheme: dark,
                 elements: {
                   rootBox: "mx-auto",
                   card: "shadow-none border-0"
                 }
               }}
             />
           )}
         </div>
       </DialogContent>
    </Dialog>
  );
} 