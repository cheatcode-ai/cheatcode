from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr

from services.email import email_service
from utils.auth_utils import verify_admin_api_key
from utils.logger import logger
from utils.rate_limit import limiter

router = APIRouter()


class SendWelcomeEmailRequest(BaseModel):
    email: EmailStr
    name: str | None = None


class EmailResponse(BaseModel):
    success: bool
    message: str


@router.post("/send-welcome-email", response_model=EmailResponse)
@limiter.limit("3/minute")
async def send_welcome_email(request: Request, email_request: SendWelcomeEmailRequest, _: bool = Depends(verify_admin_api_key)):
    try:

        def send_email():
            return email_service.send_welcome_email(user_email=email_request.email, user_name=email_request.name)

        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor() as executor:
            executor.submit(send_email)

        return EmailResponse(success=True, message="Welcome email sent")

    except Exception as e:
        logger.error(f"Error sending welcome email for {email_request.email}: {e!s}")
        raise HTTPException(status_code=500, detail="Internal server error while sending welcome email") from e
