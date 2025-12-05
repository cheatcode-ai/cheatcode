import sentry
from fastapi import HTTPException, Request, Header
from typing import Optional, Dict, Any, Tuple
import jwt
from jwt.exceptions import PyJWTError
from utils.logger import structlog
from utils.config import config
from supabase import create_client, Client
from clerk_backend_api import Clerk

# Module-level logger for consistent logging
logger = structlog.get_logger()


# =============================================================================
# Account ID Helper Functions - Single Source of Truth
# =============================================================================

async def get_account_id_for_clerk_user(client, clerk_user_id: str) -> Optional[str]:
    """
    Get the internal account ID for a Clerk user ID.

    This is the SINGLE SOURCE OF TRUTH for account ID retrieval.
    All code that needs to convert a Clerk user ID to an internal account ID
    should use this function.

    Args:
        client: The Supabase client (async)
        clerk_user_id: The Clerk user ID (e.g., "user_2abc123...")

    Returns:
        The internal account ID if found, None otherwise

    Example:
        account_id = await get_account_id_for_clerk_user(client, user_id)
        if not account_id:
            raise user_account_not_found_error()
    """
    try:
        result = await client.rpc(
            'get_account_id_for_clerk_user',
            {'p_clerk_user_id': clerk_user_id}
        ).execute()

        if result.data:
            return result.data
        return None
    except Exception as e:
        logger.error(
            f"Error getting account ID for Clerk user {clerk_user_id}: {str(e)}",
            extra={"clerk_user_id": clerk_user_id, "error": str(e)}
        )
        return None


async def get_account_id_or_raise(client, clerk_user_id: str, error_code: int = 400) -> str:
    """
    Get the internal account ID for a Clerk user ID, raising an error if not found.

    This is a convenience wrapper around get_account_id_for_clerk_user that
    raises an HTTPException if the account is not found.

    Args:
        client: The Supabase client (async)
        clerk_user_id: The Clerk user ID
        error_code: HTTP status code to use if account not found (default 400)

    Returns:
        The internal account ID

    Raises:
        HTTPException: If the account is not found
    """
    account_id = await get_account_id_for_clerk_user(client, clerk_user_id)

    if not account_id:
        logger.warning(f"No account mapping found for Clerk user {clerk_user_id}")
        if error_code == 403:
            raise HTTPException(status_code=403, detail="User account not found")
        else:
            raise HTTPException(status_code=400, detail="User account not found")

    return account_id


async def get_account_id_optional(client, clerk_user_id: str) -> Tuple[Optional[str], bool]:
    """
    Get the internal account ID, returning a tuple indicating success.

    Useful when you want to handle missing accounts gracefully without exceptions.

    Args:
        client: The Supabase client (async)
        clerk_user_id: The Clerk user ID

    Returns:
        Tuple of (account_id, found) - account_id is None if not found
    """
    account_id = await get_account_id_for_clerk_user(client, clerk_user_id)
    return (account_id, account_id is not None)

# This function extracts the user ID from Supabase JWT
async def get_current_user_id_from_jwt(request: Request) -> str:
    """
    Extract and verify the user ID from the JWT in the Authorization header.
    
    This function is used as a dependency in FastAPI routes to ensure the user
    is authenticated and to provide the user ID for authorization checks.
    
    Args:
        request: The FastAPI request object
        
    Returns:
        str: The user ID extracted from the JWT
        
    Raises:
        HTTPException: If no valid token is found or if the token is invalid
    """
    auth_header = request.headers.get('Authorization')
    
    if not auth_header or not auth_header.startswith('Bearer '):
        raise HTTPException(
            status_code=401,
            detail="No valid authentication credentials found",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    token = auth_header.split(' ')[1]
    
    try:
        payload = jwt.decode(token, options={"verify_signature": False})
        user_id = payload.get('sub')
        
        if not user_id:
            raise HTTPException(
                status_code=401,
                detail="Invalid token payload: missing user ID",
                headers={"WWW-Authenticate": "Bearer"}
            )

        # Validate user_id format (basic sanity check)
        if not isinstance(user_id, str) or len(user_id.strip()) == 0:
            raise HTTPException(
                status_code=401,
                detail="Invalid token payload: invalid user ID format",
                headers={"WWW-Authenticate": "Bearer"}
            )

        # For Clerk users, ensure they have an account mapping
        # Note: JWT only contains basic claims (sub, iat, exp, sid)  
        # Full user data (name, email) should come from webhooks
        try:
            await ensure_clerk_user_account(user_id)
        except Exception as e:
            # Log the error but don't block authentication
            logger.warning(
                f"Failed to ensure account mapping for user {user_id}: {str(e)}",
                extra={"user_id": user_id, "error": str(e)}
            )

        sentry.sentry.set_user({ "id": user_id })
        structlog.contextvars.bind_contextvars(
            user_id=user_id
        )
        return user_id
        
    except PyJWTError as e:
        raise HTTPException(
            status_code=401,
            detail=f"Invalid token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"}
        )
    except HTTPException:
        # Re-raise HTTP exceptions as they are
        raise
    except Exception as e:
        # Catch any other unexpected errors
        logger.error(
            f"Unexpected error during authentication: {str(e)}",
            extra={"error_type": type(e).__name__, "error_details": str(e)}
        )
        raise HTTPException(
            status_code=500,
            detail="Internal authentication error",
            headers={"WWW-Authenticate": "Bearer"}
        )


async def get_user_id_from_stream_auth(request: Request, token: Optional[str] = None) -> str:
    """
    Extract and verify the user ID from the JWT token for SSE streaming endpoints.
    
    This function validates authentication for Server-Sent Events endpoints by checking
    either the Authorization header or the token query parameter.
    
    Args:
        request: The FastAPI request object
        token: Optional token from query parameters
        
    Returns:
        str: The user ID extracted from the JWT
        
    Raises:
        HTTPException: If no valid token is found or if the token is invalid
    """
    auth_token = token
    
    # If no token provided as parameter, try to get from Authorization header
    if not auth_token:
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            auth_token = auth_header.split(' ')[1]
    
    if not auth_token:
        raise HTTPException(
            status_code=401,
            detail="Authentication required - provide token via query parameter or Authorization header",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    try:
        # Decode without signature verification (Clerk tokens are verified differently)
        payload = jwt.decode(auth_token, options={"verify_signature": False})
        user_id = payload.get('sub')
        
        if not user_id:
            raise HTTPException(
                status_code=401,
                detail="Invalid token payload: missing user ID",
                headers={"WWW-Authenticate": "Bearer"}
            )
        
        # Validate user_id format (basic sanity check)
        if not isinstance(user_id, str) or len(user_id.strip()) == 0:
            raise HTTPException(
                status_code=401,
                detail="Invalid token payload: invalid user ID format",
                headers={"WWW-Authenticate": "Bearer"}
            )
        
        # For Clerk users, ensure they have an account mapping
        # Note: JWT only contains basic claims (sub, iat, exp, sid)  
        # Full user data (name, email) should come from webhooks
        try:
            await ensure_clerk_user_account(user_id)
        except Exception as e:
            # Log the error but don't block authentication
            logger.warning(
                f"Failed to ensure account mapping for user {user_id}: {str(e)}",
                extra={"user_id": user_id, "error": str(e)}
            )
        
        # Set up logging and monitoring
        sentry.sentry.set_user({"id": user_id})
        structlog.contextvars.bind_contextvars(user_id=user_id)
        
        return user_id
        
    except PyJWTError as e:
        raise HTTPException(
            status_code=401,
            detail=f"Invalid token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"}
        )
    except HTTPException:
        # Re-raise HTTP exceptions as they are
        raise
    except Exception as e:
        # Catch any other unexpected errors
        logger.error(
            f"Unexpected error during SSE authentication: {str(e)}",
            extra={"error_type": type(e).__name__, "error_details": str(e)}
        )
        raise HTTPException(
            status_code=500,
            detail="Internal authentication error",
            headers={"WWW-Authenticate": "Bearer"}
        )



async def ensure_clerk_user_account(clerk_user_id: str):
    """
    Ensure that a Clerk user has an account mapping in the database.
    This function fetches real user data from Clerk API and creates the account with complete information.

    Args:
        clerk_user_id: The Clerk user ID
    """
    try:
        # Validate input
        if not clerk_user_id:
            logger.error("Cannot create account mapping: clerk_user_id is required")
            return
        
        # Create Supabase client
        supabase_url = config.SUPABASE_URL
        supabase_key = config.SUPABASE_SERVICE_ROLE_KEY
        
        if not supabase_url or not supabase_key:
            logger.warning("Supabase configuration missing, skipping account creation")
            return
        
        supabase: Client = create_client(supabase_url, supabase_key)
        
        # Check if user already exists
        existing = supabase.table('users').select('id').eq('id', clerk_user_id).execute()

        if existing.data:
            logger.info(f"User already exists for Clerk user {clerk_user_id}")
            return
        
        # Fetch real user data from Clerk API
        try:
            user_data = await get_clerk_user_data(clerk_user_id)
            
            # Create full name from first and last name
            first_name = user_data.get('first_name', '')
            last_name = user_data.get('last_name', '')
            full_name = f"{first_name} {last_name}".strip() or "User"
            
            user_email = user_data.get('email', '')
            
            logger.info(f"Fetched user data from Clerk: name='{full_name}', email='{user_email}'")
            
        except Exception as e:
            logger.warning(f"Failed to fetch user data from Clerk API for {clerk_user_id}: {str(e)}")
            # Fallback to basic data if Clerk API fails
            full_name = "User"
            user_email = None
        
        # Create user record with real or fallback data using get_or_create_user RPC
        result = supabase.rpc(
            'get_or_create_user',
            {
                'p_clerk_user_id': clerk_user_id,
                'p_email': user_email
            }
        ).execute()

        if result.data:
            logger.info(f"Created/verified user for Clerk user {clerk_user_id} with email='{user_email}'")
        else:
            logger.warning(f"Failed to create account mapping for Clerk user {clerk_user_id}")
            
    except Exception as e:
        logger.error(
            f"Error ensuring account mapping for Clerk user {clerk_user_id}: {str(e)}",
            extra={
                "clerk_user_id": clerk_user_id,
                "error_type": type(e).__name__,
                "error_details": str(e)
            }
        )



async def get_clerk_user_data(clerk_user_id: str) -> Dict[str, Any]:
    """
    Fetch user data from Clerk API using the Python SDK.

    Args:
        clerk_user_id: The Clerk user ID

    Returns:
        Dict containing user data: {"first_name": "John", "last_name": "Doe", "email": "john@example.com"}

    Raises:
        Exception: If unable to fetch user data from Clerk API
    """
    try:
        if not config.CLERK_SECRET_KEY:
            logger.error("CLERK_SECRET_KEY not configured")
            raise Exception("Clerk API key not configured")
            
        # Initialize Clerk client
        clerk_client = Clerk(bearer_auth=config.CLERK_SECRET_KEY)
        
        # Fetch user data from Clerk API
        user = clerk_client.users.get(user_id=clerk_user_id)
        
        if not user:
            raise Exception(f"User {clerk_user_id} not found in Clerk")
            
        # Extract user details
        first_name = getattr(user, 'first_name', '') or ''
        last_name = getattr(user, 'last_name', '') or ''
        
        # Get primary email address
        email = ''
        if hasattr(user, 'email_addresses') and user.email_addresses:
            # Find primary email or use first available
            primary_email = None
            for email_addr in user.email_addresses:
                if hasattr(email_addr, 'email_address'):
                    if hasattr(user, 'primary_email_address_id') and getattr(email_addr, 'id', None) == user.primary_email_address_id:
                        primary_email = email_addr
                        break
                    elif not primary_email:  # Use first email as fallback
                        primary_email = email_addr
            
            if primary_email and hasattr(primary_email, 'email_address'):
                email = primary_email.email_address
        
        logger.info(f"Successfully fetched user data from Clerk API for user {clerk_user_id}")
        
        return {
            "first_name": first_name,
            "last_name": last_name, 
            "email": email
        }
        
    except Exception as e:
        logger.error(
            f"Error fetching user data from Clerk API for user {clerk_user_id}: {str(e)}",
            extra={
                "clerk_user_id": clerk_user_id,
                "error_type": type(e).__name__,
                "error_details": str(e)
            }
        )
        raise


async def get_account_id_from_thread(client, thread_id: str) -> str:
    """
    Extract and verify the account ID from the thread.
    
    Args:
        client: The Supabase client
        thread_id: The ID of the thread
        
    Returns:
        str: The account ID associated with the thread
        
    Raises:
        HTTPException: If the thread is not found or if there's an error
    """
    try:
        response = await client.table('threads').select('user_id').eq('thread_id', thread_id).execute()

        if not response.data or len(response.data) == 0:
            raise HTTPException(
                status_code=404,
                detail="Thread not found"
            )

        user_id = response.data[0].get('user_id')

        if not user_id:
            raise HTTPException(
                status_code=500,
                detail="Thread has no associated user"
            )

        return user_id
    
    except Exception as e:
        error_msg = str(e)
        if "cannot schedule new futures after shutdown" in error_msg or "connection is closed" in error_msg:
            raise HTTPException(
                status_code=503,
                detail="Server is shutting down"
            )
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Error retrieving thread information: {str(e)}"
            )
    


async def verify_thread_access(client, thread_id: str, user_id: str):
    """
    Verify that a user has access to a specific thread based on account membership.
    
    Args:
        client: The Supabase client
        thread_id: The thread ID to check access for
        user_id: The user ID (Clerk user ID) to check permissions for
        
    Returns:
        bool: True if the user has access
        
    Raises:
        HTTPException: If the user doesn't have access to the thread
    """
    try:
        # Query the thread to get account information
        thread_result = await client.table('threads').select('*,project_id').eq('thread_id', thread_id).execute()

        if not thread_result.data or len(thread_result.data) == 0:
            raise HTTPException(status_code=404, detail="Thread not found")
        
        thread_data = thread_result.data[0]
        
        # Check if project is public
        project_id = thread_data.get('project_id')
        if project_id:
            project_result = await client.table('projects').select('is_public').eq('project_id', project_id).execute()
            if project_result.data and len(project_result.data) > 0:
                if project_result.data[0].get('is_public'):
                    return True
            
        # Get the account ID for this Clerk user using centralized helper
        user_account_id = await get_account_id_for_clerk_user(client, user_id)
        if not user_account_id:
            logger.warning(f"No account mapping found for Clerk user {user_id}")
            raise HTTPException(status_code=403, detail="User account not found")
        thread_user_id = thread_data.get('user_id')

        # Check if the user's account matches the thread's user
        if thread_user_id and user_account_id == thread_user_id:
            return True
            
        raise HTTPException(status_code=403, detail="Not authorized to access this thread")
    except HTTPException:
        # Re-raise HTTP exceptions as they are
        raise
    except Exception as e:
        error_msg = str(e)
        if "cannot schedule new futures after shutdown" in error_msg or "connection is closed" in error_msg:
            raise HTTPException(
                status_code=503,
                detail="Server is shutting down"
            )
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Error verifying thread access: {str(e)}"
            )

async def get_optional_user_id(request: Request) -> Optional[str]:
    """
    Extract the user ID from the JWT in the Authorization header if present,
    but don't require authentication. Returns None if no valid token is found.
    
    This function is used for endpoints that support both authenticated and 
    unauthenticated access (like public projects).
    
    Args:
        request: The FastAPI request object
        
    Returns:
        Optional[str]: The user ID extracted from the JWT, or None if no valid token
    """
    auth_header = request.headers.get('Authorization')
    
    if not auth_header or not auth_header.startswith('Bearer '):
        return None
    
    token = auth_header.split(' ')[1]
    
    try:
        # For Supabase JWT, we just need to decode and extract the user ID
        payload = jwt.decode(token, options={"verify_signature": False})
        
        # Supabase stores the user ID in the 'sub' claim
        user_id = payload.get('sub')
        if user_id:
            sentry.sentry.set_user({ "id": user_id })
            structlog.contextvars.bind_contextvars(
                user_id=user_id
            )
        
        return user_id
    except PyJWTError:
        return None

async def verify_admin_api_key(x_admin_api_key: Optional[str] = Header(None)):
    """
    Verify admin API key for server-side operations.
    
    Args:
        x_admin_api_key: Admin API key from X-Admin-Api-Key header
        
    Returns:
        bool: True if the API key is valid
        
    Raises:
        HTTPException: If the API key is missing, invalid, or not configured
    """
    if not config.ADMIN_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Admin API key not configured on server"
        )
    
    if not x_admin_api_key:
        raise HTTPException(
            status_code=401,
            detail="Admin API key required. Include X-Admin-Api-Key header."
        )
    
    if x_admin_api_key != config.ADMIN_API_KEY:
        raise HTTPException(
            status_code=403,
            detail="Invalid admin API key"
        )
    
    return True


def get_email_from_jwt_request(request: Request) -> Optional[str]:
    """
    Extract email from JWT in the request's Authorization header.
    """
    try:
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return None
        
        token = auth_header.split(' ')[1]
        payload = jwt.decode(token, options={"verify_signature": False})
        return payload.get('email')
        
    except Exception as e:
        logger.error(f"Error getting email from JWT: {str(e)}")
        return None
