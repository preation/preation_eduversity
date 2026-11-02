
import os
import re
import logging
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import create_client

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("preation")

URL = os.getenv("SUPABASE_URL")
KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY")

if not URL or not KEY:
    raise RuntimeError("Supabase URL or Publishable Key is missing from .env")


app = FastAPI(title="Preation Eduversity API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500", "http://localhost:5500"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"]
)

security = HTTPBearer()


# SUPABASE CONNECTION


def get_supabase(token=None):
    client = create_client(URL, KEY)
    if token:
        client.postgrest.auth(token)
    return client



# REQUEST MODELS

class CourseCreateData(BaseModel):
    code: str = Field(min_length=2, max_length=20)
    title: str = Field(min_length=2, max_length=150)
    department: str = Field(min_length=2, max_length=100)
    credits: int = Field(gt=0)
    capacity: int = Field(ge=0)
    schedule: str | None = Field(default=None, max_length=200)
    prerequisites: str | None = Field(default=None, max_length=500)
    active: bool = True

class CourseUpdateData(BaseModel):
    code: str | None = Field(default=None, min_length=2, max_length=20)
    title: str | None = Field(default=None, min_length=2, max_length=150)
    department: str | None = Field(default=None, min_length=2, max_length=100)
    credits: int | None = Field(default=None, gt=0)
    capacity: int | None = Field(default=None, ge=0)
    schedule: str | None = Field(default=None, max_length=200)
    prerequisites: str | None = Field(default=None, max_length=500)
    active: bool | None = None

class RegisterData(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    department: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)


class LoginData(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=1, max_length=128)

class RefreshData(BaseModel):
    refresh_token: str = Field(min_length=1)

def check_email(email):
    return re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) is not None

def session_response(session, user, role, account):
    return {
        "access_token": session.access_token,
        "refresh_token": session.refresh_token,
        "token_type": session.token_type,
        "expires_in": session.expires_in,
        "user": {
            "id": user.id,
            "email": user.email,
            "role": role,
            "profile": account
        }
    }

# CHECK DATABASE ROLE

def get_account_role(client, user_id):
    try:
        # First check whether the user is an admin.
        admin_response = (
            client.table("admins")
            .select("admin_id,name,email")
            .eq("admin_id", user_id)
            .limit(1)
            .execute()
        )

        admins = admin_response.data or []

        if admins:
            return "admin", admins[0]

        # If not an admin, check the student profile.
        profile_response = (
            client.table("profiles")
            .select("id,name,email,department")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )

        profiles = profile_response.data or []

        if profiles:
            return "student", profiles[0]

        logger.warning("No profile or admin record found for user: %s", user_id)
        return None, None

    except Exception:
        logger.exception("Database role lookup failed for user: %s", user_id)
        raise HTTPException(
            status_code=500,
            detail="Unable to verify account permissions."
        )

# STUDENT REGISTRATION

@app.post("/auth/register", status_code=201)
def register_student(data: RegisterData):
    if not check_email(data.email):
        raise HTTPException(400, "Enter a valid email address.")

    client = get_supabase()

    try:
        response = client.auth.sign_up({
            "email": data.email.strip().lower(),
            "password": data.password,
            "options": {
                "data": {
                    "name": data.name.strip(),
                    "department": data.department.strip()
                }
            }
        })

        if not response.session:
            raise HTTPException(
                400,
                "Registration requires an active session. Check that Confirm Email is disabled in Supabase."
            )

        logger.info("Student registration completed: %s", response.user.id)

        return session_response(
            response.session,
            response.user,
            "student",
            {"name": data.name, "department": data.department}
        )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Student registration failed")
        raise HTTPException(
            400,
            "Registration failed. Check your details or whether the email is already registered."
        )
    
# STUDENT AND ADMIN LOGIN

@app.post("/auth/login")
def login(data: LoginData):
    if not check_email(data.email):
        raise HTTPException(400, "Enter a valid email address.")

    client = get_supabase()

    try:
        response = client.auth.sign_in_with_password({
            "email": data.email.strip().lower(),
            "password": data.password
        })

        if not response.session:
            raise HTTPException(401, "Login failed.")

        user = response.user
        token = response.session.access_token

        user_client = get_supabase(token)
        role, account = get_account_role(user_client, user.id)

        if not role:
            raise HTTPException(403, "Account has no assigned application access.")
        
        logger.info("Login successful: user=%s role=%s", user.id, role)

        return session_response(response.session, user, role, account)

    except HTTPException:
        raise
    except Exception:
        logger.exception("Login failed")
        raise HTTPException(401, "Invalid email or password.")


# VERIFY CURRENT SESSION AND ROLE

def current_account(
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    token = credentials.credentials
    client = get_supabase()

    try:
        response = client.auth.get_user(token)
        user = response.user

        if not user:
            raise HTTPException(401, "Invalid session.")

        user_client = get_supabase(token)
        role, account = get_account_role(user_client, user.id)

        if not role:
            raise HTTPException(403, "Account access is not assigned.")

        return {
            "id": user.id,
            "email": user.email,
            "role": role,
            "profile": account
        }

    except HTTPException:
        raise
    except Exception:
        logger.exception("Session verification failed")
        raise HTTPException(401, "Invalid or expired session.")


@app.get("/auth/me")
def get_current_user(account=Depends(current_account)):
    return account

# ADMIN COURSE MANAGEMENT

@app.post("/courses", status_code=201)
def create_course(
    data: CourseCreateData,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    account=Depends(current_account)
):
    # Only database-verified admins can create courses.
    if account["role"] != "admin":
        raise HTTPException(
            status_code=403,
            detail="Only administrators can add courses."
        )

    client = get_supabase(credentials.credentials)

    try:
        payload = data.model_dump(exclude_none=True)

        # Normalize text fields before saving.
        payload["code"] = data.code.strip().upper()
        payload["title"] = data.title.strip()
        payload["department"] = data.department.strip()

        if not all([
            payload["code"],
            payload["title"],
            payload["department"]
        ]):
            raise HTTPException(
                status_code=400,
                detail="Course code, title and department cannot be empty."
            )

        if "schedule" in payload:
            payload["schedule"] = payload["schedule"].strip()

        if "prerequisites" in payload:
            payload["prerequisites"] = payload["prerequisites"].strip()

        response = (
            client.table("courses")
            .insert(payload)
            .select(COURSE_COLUMNS)
            .execute()
        )

        courses = response.data or []

        if not courses:
            raise HTTPException(
                status_code=500,
                detail="Course could not be created."
            )

        logger.info(
            "Course created: code=%s admin=%s",
            payload["code"],
            account["id"]
        )

        return {
            "message": "Course created successfully.",
            "course": courses[0]
        }

    except HTTPException:
        raise
    except Exception as error:
        if (
            getattr(error, "code", None) == "23505"
            or "duplicate key" in str(error).lower()
        ):
            raise HTTPException(
                status_code=409,
                detail="A course with this course code already exists."
            )

        logger.exception("Course creation failed")
        raise HTTPException(
            status_code=500,
            detail="Unable to create course."
        )


# ADMIN DASHBOARD


@app.get("/admin/dashboard")
def admin_dashboard(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    account=Depends(current_account)
):
    if account["role"] != "admin":
        raise HTTPException(403, "Admin access required.")

    client = get_supabase(credentials.credentials)

    try:
        courses = (
            client.table("courses")
            .select("course_id,active")
            .execute()
            .data or []
        )

        students = get_student_profiles(client)

        enrollments = (
            client.table("enrollments")
            .select("status")
            .execute()
            .data or []
        )

        return {
            "statistics": {
                "total_courses": len(courses),
                "active_courses": sum(
                    1 for c in courses if c["active"]
                ),
                "inactive_courses": sum(
                    1 for c in courses if not c["active"]
                ),
                "total_students": len(students),
                "total_enrollments": len(enrollments),
                "active_enrollments": sum(
                    1 for e in enrollments if e["status"] == "active"
                ),
                "dropped_enrollments": sum(
                    1 for e in enrollments if e["status"] == "dropped"
                ),
                "completed_enrollments": sum(
                    1 for e in enrollments if e["status"] == "completed"
                )
            }
        }

    except Exception:
        logger.exception("Admin dashboard retrieval failed")
        raise HTTPException(500, "Unable to load admin dashboard.")


# RETURN STUDENT PROFILES ONLY

def get_student_profiles(client):
    admin_response = (
        client.table("admins")
        .select("admin_id")
        .execute()
    )

    admin_ids = {
        row["admin_id"]
        for row in (admin_response.data or [])
    }

    profile_response = (
        client.table("profiles")
        .select("id,name,email,department,created_at")
        .order("created_at", desc=True)
        .execute()
    )

    profiles = profile_response.data or []

    return [
        profile for profile in profiles
        if profile["id"] not in admin_ids
    ]

# VIEW ALL COURSES, INCLUDING INACTIVE

@app.get("/admin/courses")
def admin_courses(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    account=Depends(current_account)
):
    if account["role"] != "admin":
        raise HTTPException(403, "Admin access required.")

    client = get_supabase(credentials.credentials)

    try:
        response = (
            client.table("courses")
            .select(COURSE_COLUMNS)
            .order("course_id", desc=True)
            .execute()
        )

        return {"courses": response.data or []}

    except Exception:
        logger.exception("Admin course listing failed")
        raise HTTPException(500, "Unable to retrieve courses.")


# EDIT OR DEACTIVATE A COURSE

@app.patch("/admin/courses/{course_id}")
def update_course(
    course_id: int,
    data: CourseUpdateData,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    account=Depends(current_account)
):
    if account["role"] != "admin":
        raise HTTPException(403, "Admin access required.")

    payload = data.model_dump(exclude_unset=True, exclude_none=True)

    if not payload:
        raise HTTPException(400, "Provide at least one field to update.")

    for field in ("code", "title", "department"):
        if field in payload:
            if payload[field] is None:
                raise HTTPException(400, f"{field} cannot be empty.")
            payload[field] = payload[field].strip()

            if not payload[field]:
                raise HTTPException(400, f"{field} cannot be empty.")

    for field in ("credits", "capacity", "active"):
        if field in payload and payload[field] is None:
            raise HTTPException(400, f"{field} cannot be empty.")

    if "code" in payload:
        payload["code"] = payload["code"].upper()

    for field in ("schedule", "prerequisites"):
        if field in payload and payload[field] is not None:
            payload[field] = payload[field].strip()

    client = get_supabase(credentials.credentials)

    try:
        response = (
            client.table("courses")
            .update(payload)
            .eq("course_id", course_id)
            .select(COURSE_COLUMNS)
            .execute()
        )

        updated = response.data or []

        if not updated:
            raise HTTPException(404, "Course not found.")

        logger.info(
            "Course updated: course_id=%s admin=%s",
            course_id, account["id"]
        )

        return {
            "message": "Course updated successfully.",
            "course": updated[0]
        }

    except HTTPException:
        raise
    except Exception:
        logger.exception("Course update failed")
        raise HTTPException(500, "Unable to update course.")


# VIEW REGISTERED STUDENTS


@app.get("/admin/students")
def admin_students(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    account=Depends(current_account)
):
    if account["role"] != "admin":
        raise HTTPException(403, "Admin access required.")

    client = get_supabase(credentials.credentials)

    try:
        students = get_student_profiles(client)

        return {
            "students": students,
            "count": len(students)
        }

    except Exception:
        logger.exception("Student listing failed")
        raise HTTPException(500, "Unable to retrieve students.")


# VIEW ALL ENROLLMENTS

@app.get("/admin/enrollments")
def admin_enrollments(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    account=Depends(current_account)
):
    if account["role"] != "admin":
        raise HTTPException(403, "Admin access required.")

    client = get_supabase(credentials.credentials)

    try:
        response = (
            client.table("enrollments")
            .select("*")
            .order("enrollment_date", desc=True)
            .execute()
        )

        return {"enrollments": response.data or []}

    except Exception:
        logger.exception("Admin enrollment listing failed")
        raise HTTPException(500, "Unable to retrieve enrollments.")

# REFRESH SESSION

@app.post("/auth/refresh")
def refresh_session(data: RefreshData):
    client = get_supabase()

    try:
        response = client.auth.refresh_session(data.refresh_token)
        session = response.session

        if not session:
            raise HTTPException(401, "Session could not be refreshed.")

        user = response.user
        user_client = get_supabase(session.access_token)
        role, account = get_account_role(user_client, user.id)

        if not role:
            raise HTTPException(403, "Account access is not assigned.")

        logger.info("Session refreshed: user=%s", user.id)

        return session_response(session, user, role, account)

    except HTTPException:
        raise
    except Exception:
        logger.exception("Session refresh failed")
        raise HTTPException(401, "Session expired. Please log in again.")


# COURSE BROWSING

COURSE_COLUMNS = (
    "course_id,code,title,department,credits,"
    "capacity,schedule,prerequisites,active"
)


@app.get("/courses")
def get_courses(
    search: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0)
):
    client = get_supabase()

    try:
        query = (
            client.table("courses")
            .select(COURSE_COLUMNS)
            .eq("active", True)
        )

        # Search by course code, title, or department.
        if search and search.strip():
            term = search.strip()

            # Keep the search expression safe for PostgREST.
            if not re.fullmatch(r"[A-Za-z0-9 _-]{1,80}", term):
                raise HTTPException(
                    400,
                    "Search using letters, numbers, spaces, hyphens or underscores."
                )

            query = query.or_(
                f"code.ilike.%{term}%,"
                f"title.ilike.%{term}%,"
                f"department.ilike.%{term}%"
            )

        response = (
            query
            .order("title")
            .range(offset, offset + limit - 1)
            .execute()
        )

        courses = response.data or []

        return {
            "courses": courses,
            "count": len(courses),
            "limit": limit,
            "offset": offset
        }

    except HTTPException:
        raise
    except Exception:
        logger.exception("Course listing failed")
        raise HTTPException(
            500,
            "Unable to retrieve courses."
        )


@app.get("/courses/{course_id}")
def get_course(course_id: int):
    client = get_supabase()

    try:
        response = (
            client.table("courses")
            .select(COURSE_COLUMNS)
            .eq("course_id", course_id)
            .eq("active", True)
            .limit(1)
            .execute()
        )

        courses = response.data or []

        if not courses:
            raise HTTPException(
                404,
                "Course not found or currently unavailable."
            )

        return {"course": courses[0]}

    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "Course details retrieval failed: course_id=%s",
            course_id
        )
        raise HTTPException(
            500,
            "Unable to retrieve course details."
        )


# STUDENT DASHBOARD

@app.get("/student/dashboard")
def student_dashboard(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    account=Depends(current_account)
):
    if account["role"] != "student":
        raise HTTPException(403, "Student access required.")

    client = get_supabase(credentials.credentials)

    try:
        enrollments = (
            client.table("enrollments")
            .select("*")
            .eq("student_id", account["id"])
            .order("enrollment_date", desc=True)
            .execute()
            .data or []
        )

        course_ids = list({
            e["course_id"] for e in enrollments
        })

        courses = []

        if course_ids:
            courses = (
                client.table("courses")
                .select(COURSE_COLUMNS)
                .in_("course_id", course_ids)
                .execute()
                .data or []
            )

        course_map = {
            c["course_id"]: c for c in courses
        }

        my_courses = [
            {
                "enrollment": enrollment,
                "course": course_map.get(enrollment["course_id"])
            }
            for enrollment in enrollments
        ]

        active_count = sum(
            1 for e in enrollments if e["status"] == "active"
        )

        return {
            "profile": account["profile"],
            "statistics": {
                "total_enrollments": len(enrollments),
                "active_enrollments": active_count,
                "completed_courses": sum(
                    1 for e in enrollments if e["status"] == "completed"
                ),
                "dropped_courses": sum(
                    1 for e in enrollments if e["status"] == "dropped"
                )
            },
            "my_courses": my_courses
        }

    except Exception:
        logger.exception("Student dashboard retrieval failed")
        raise HTTPException(500, "Unable to load student dashboard.")


# STUDENT ENROLLS IN A COURSE

@app.post("/courses/{course_id}/enroll", status_code=201)
def enroll_course(
    course_id: int,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    account=Depends(current_account)
):
    if account["role"] != "student":
        raise HTTPException(403, "Student access required.")

    client = get_supabase(credentials.credentials)

    try:
        response = client.rpc(
            "enroll_in_course",
            {"p_course_id": course_id}
        ).execute()

        return {
            "message": "Enrollment successful.",
            "enrollment": response.data
        }

    except Exception as error:
        error_text = str(error).upper()

        if "COURSE_NOT_AVAILABLE" in error_text:
            raise HTTPException(404, "Course is unavailable.")

        if "COURSE_FULL" in error_text:
            raise HTTPException(409, "This course has no available seats.")

        if "ALREADY_ENROLLED" in error_text:
            raise HTTPException(409, "You are already enrolled in this course.")

        if "STUDENT_PROFILE_REQUIRED" in error_text:
            raise HTTPException(403, "Student profile not found.")

        logger.exception("Course enrollment failed")
        raise HTTPException(500, "Unable to complete enrollment.")


# STUDENT DROPS A COURSE

@app.delete("/student/enrollments/{course_id}")
def drop_course(
    course_id: int,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    account=Depends(current_account)
):
    if account["role"] != "student":
        raise HTTPException(403, "Student access required.")

    client = get_supabase(credentials.credentials)

    try:
        response = client.rpc(
            "drop_course_enrollment",
            {"p_course_id": course_id}
        ).execute()

        return {
            "message": "Course dropped successfully.",
            "enrollment": response.data
        }

    except Exception as error:
        error_text = str(error).upper()

        if "ENROLLMENT_NOT_FOUND" in error_text:
            raise HTTPException(404, "Active enrollment not found.")

        logger.exception("Course drop failed")
        raise HTTPException(500, "Unable to drop course.")

# BASIC ROUTES

@app.get("/")
def home():
    return {
        "app": "Preation Eduversity",
        "status": "running"
    }

@app.get("/health")
def health():
    return {"status": "ok"}
