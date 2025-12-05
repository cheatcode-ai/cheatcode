import logging
from typing import Optional
import mailtrap as mt
from utils.config import config

logger = logging.getLogger(__name__)

class EmailService:
    def __init__(self):
        # Use centralized config for environment variables
        self.api_token = config.MAILTRAP_API_TOKEN
        self.sender_email = getattr(config, 'MAILTRAP_SENDER_EMAIL', None) or 'hello@cheatcode.ai'
        self.sender_name = getattr(config, 'MAILTRAP_SENDER_NAME', None) or 'CheatCode AI Team'
        
        if not self.api_token:
            logger.warning("MAILTRAP_API_TOKEN not found in environment variables")
            self.client = None
        else:
            self.client = mt.MailtrapClient(token=self.api_token)
    
    def send_welcome_email(self, user_email: str, user_name: Optional[str] = None) -> bool:
        if not self.client:
            logger.error("Cannot send email: MAILTRAP_API_TOKEN not configured")
            return False
    
        if not user_name:
            user_name = user_email.split('@')[0].title()
        
        subject = "Welcome to Cheatcode AI — Build Apps & Websites Seamlessly!"
        html_content = self._get_welcome_email_template(user_name)
        text_content = self._get_welcome_email_text(user_name)
        
        return self._send_email(
            to_email=user_email,
            to_name=user_name,
            subject=subject,
            html_content=html_content,
            text_content=text_content
        )
    
    def _send_email(
        self, 
        to_email: str, 
        to_name: str, 
        subject: str, 
        html_content: str, 
        text_content: str
    ) -> bool:
        try:
            mail = mt.Mail(
                sender=mt.Address(email=self.sender_email, name=self.sender_name),
                to=[mt.Address(email=to_email, name=to_name)],
                subject=subject,
                text=text_content,
                html=html_content,
                category="welcome"
            )
            
            response = self.client.send(mail)
            
            logger.info(f"Welcome email sent to {to_email}. Response: {response}")
            return True
                
        except Exception as e:
            logger.error(f"Error sending email to {to_email}: {str(e)}")
            return False
    
    def _get_welcome_email_template(self, user_name: str) -> str:
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Cheatcode AI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    /* Using a modern font for better aesthetics */
    body {{
      font-family: 'Inter', sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }}
  </style>
</head>
<body class="bg-[#111827] text-gray-300">
  <div class="max-w-2xl mx-auto my-12 px-6 sm:px-8">
    
    <!-- Header Section -->
    <header class="text-center mb-12">
      <img src="https://i.ibb.co/bjYvDhmj/favicon.png" alt="Cheatcode AI Logo" class="mx-auto h-20 w-auto mb-6">
      <h1 class="text-4xl font-bold text-white tracking-tight">
        <span class="bg-gradient-to-r from-blue-500 to-cyan-400 text-transparent bg-clip-text">cheatcode ai</span>
      </h1>
      <p class="mt-3 text-lg text-gray-400">welcome to the future of development!</p>
    </header>

    <!-- Main Content -->
    <main class="bg-[#1f2937]/50 ring-1 ring-white/10 rounded-2xl p-8 sm:p-10">
      
      <p class="text-lg mb-4">Hey there,</p>
      <p class="mb-6"><strong>We're thrilled to have you join the Cheatcode AI community!</strong></p>
      <p class="text-gray-400 mb-8">
        Cheatcode AI is your development companion, designed to accelerate your workflow. Whether you're building your next big idea or rapid prototyping, we're here to help you bring your vision to life.
      </p>

      <!-- Features Section -->
      <div class="space-y-6 mb-10">
        <div class="flex items-start">
          <div class="flex-shrink-0 h-8 w-8 flex items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
            <!-- SVG Icon for Build -->
            <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </div>
          <div class="ml-4">
            <h3 class="font-semibold text-white">Build Anything</h3>
            <p class="text-gray-400">Create full-stack websites, mobile apps, APIs, and more with natural language.</p>
          </div>
        </div>
        <div class="flex items-start">
          <div class="flex-shrink-0 h-8 w-8 flex items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
            <!-- SVG Icon for Seamless Dev -->
            <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div class="ml-4">
            <h3 class="font-semibold text-white">Seamless Development</h3>
            <p class="text-gray-400">From frontend to deployment, we handle the complexity.</p>
          </div>
        </div>
        <div class="flex items-start">
          <div class="flex-shrink-0 h-8 w-8 flex items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
            <!-- SVG Icon for Automation -->
            <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00-5.86 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          </div>
          <div class="ml-4">
            <h3 class="font-semibold text-white">Intelligent Automation</h3>
            <p class="text-gray-400">Let AI handle repetitive tasks so you can focus on your vision.</p>
          </div>
        </div>
      </div>

      <!-- GitHub Section -->
      <div class="bg-gray-900/50 text-center rounded-xl p-6 mb-8 ring-1 ring-white/10">
        <h2 class="text-xl font-semibold text-white mb-2">🌟 Open Source & Community Driven</h2>
        <p class="text-gray-400 mb-4">Cheatcode AI is proudly open source. Join our community and help us grow!</p>
        <a href="https://github.com/cheatcode-ai/cheatcode" class="inline-block bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-lg transition-colors">
          View on GitHub
        </a>
      </div>

      <p class="text-gray-400 mb-6">Ready to start building? Jump right in. If you have any questions or feedback, we're always here to help!</p>
      
      <p class="mb-8">Happy coding! <span class="emoji">💻</span></p>

      <p class="text-gray-500">— The Cheatcode AI Team</p>
      
      <!-- Call to Action Buttons -->
      <div class="mt-10 text-center">
        <a href="https://www.trycheatcode.com/" class="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 px-6 rounded-lg transition-colors shadow-lg shadow-blue-500/20">
          🚀 Start Building Now
        </a>
      </div>

    </main>
  </div>
</body>
</html>"""
    
    def _get_welcome_email_text(self, user_name: str) -> str:
        return f"""CHEATCODE AI
Welcome to the future of development!

Hey there,

We're thrilled to have you join the Cheatcode AI community!

Cheatcode AI is your development companion, designed to accelerate your workflow. Whether you're building your next big idea or rapid prototyping, we're here to help you bring your vision to life.

FEATURES:

🔧 Build Anything
Create full-stack websites, mobile apps, APIs, and more with natural language.

⚡ Seamless Development  
From frontend to deployment, we handle the complexity.

🎯 Intelligent Automation
Let AI handle repetitive tasks so you can focus on your vision.

🌟 OPEN SOURCE & COMMUNITY DRIVEN
Cheatcode AI is proudly open source. Join our community and help us grow!

View on GitHub: https://github.com/cheatcode-ai/cheatcode

Ready to start building? Jump right in. If you have any questions or feedback, we're always here to help!

Happy coding! 💻

— The Cheatcode AI Team

🚀 Start Building Now: https://www.trycheatcode.com/

---
© 2025 CheatCode AI. All rights reserved.
You received this email because you signed up for a CheatCode AI account."""

email_service = EmailService() 
