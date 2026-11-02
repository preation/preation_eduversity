

// Change this URL when deploying the backend.
const API_BASE_URL =
  window.location.port === "5500"
    ? "http://127.0.0.1:8000"
    : "";
const SESSION_KEY = "preation_session";
// 1. APPLICATION STATE

let session = loadSavedSession();
let currentMode = "register";
let currentAdminView = "overview";
let adminCourseCache = [];
let previousFocus = null;

function loadSavedSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || null;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveSession(data) {
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type || "bearer",
    expires_in: data.expires_in,
    user: data.user
  };

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  session = null;
  sessionStorage.removeItem(SESSION_KEY);
}


// =============================================
// 2. API CONNECTION
// =============================================

class APIError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "APIError";
    this.status = status;
  }
}

async function apiRequest(path, options = {}) {
  const {
    auth = true,
    retry = true,
    method = "GET",
    body
  } = options;

  const headers = {
    "Content-Type": "application/json"
  };

  if (auth && session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new APIError(
      "Unable to connect to the server. Check that the backend is running.",
      0
    );
  }

  // Refresh the session once when the access token expires.
  if (
    response.status === 401 &&
    auth &&
    retry &&
    session?.refresh_token
  ) {
    const refreshed = await refreshSession();

    if (refreshed) {
      return apiRequest(path, {
        ...options,
        retry: false
      });
    }
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new APIError(
      result.detail || result.message || `Request failed (${response.status}).`,
      response.status
    );
  }

  return result;
}


// =============================================
// 3. SESSION REFRESH
// =============================================

async function refreshSession() {
  if (!session?.refresh_token) return false;

  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        refresh_token: session.refresh_token
      })
    });

    if (!response.ok) {
      clearSession();
      return false;
    }

    const data = await response.json();

    if (!data.access_token || !data.refresh_token) {
      clearSession();
      return false;
    }

    saveSession(data);
    return true;

  } catch {
    // Keep the saved session if the server is temporarily unavailable.
    return false;
  }
}


// =============================================
// 4. WELCOME ANIMATION
// =============================================

function typeText(element, text, speed) {
  if (!element) return Promise.resolve();

  return new Promise(resolve => {
    let index = 0;

    function write() {
      if (index < text.length) {
        element.textContent += text[index++];
        setTimeout(write, speed);
      } else {
        resolve();
      }
    }

    write();
  });
}

async function startWelcome() {
  await typeText(
    document.getElementById("typedPreation"),
    "Preation",
    90
  );

  await typeText(
    document.getElementById("typedEduversity"),
    " Eduversity",
    65
  );
}

startWelcome();


// =============================================
// 5. AUTHENTICATION MODAL
// =============================================

const modal = document.getElementById("authModal");
const authForm = document.getElementById("authForm");
const authMessage = document.getElementById("authMessage");

const fields = {
  register: document.getElementById("registerFields"),
  studentLogin: document.getElementById("studentLoginFields"),
  adminLogin: document.getElementById("adminLoginFields")
};

const modalTitle = document.getElementById("modalTitle");
const modalDescription = document.getElementById("modalDescription");
const formSubmit = document.getElementById("formSubmit");

function openAuth(mode = "register") {
  previousFocus = document.activeElement;

  setAuthMode(mode);
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  const firstInput = fields[mode]?.querySelector("input:not(:disabled)");
  firstInput?.focus();
}

function closeAuth() {
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";

  previousFocus?.focus();
}

function setAuthMode(mode) {
  if (!fields[mode]) return;

  currentMode = mode;
  authForm.reset();
  authMessage.hidden = true;
  authMessage.textContent = "";
  authMessage.className = "auth-message";

  Object.entries(fields).forEach(([name, section]) => {
    const selected = name === mode;

    section.hidden = !selected;

    section.querySelectorAll("input").forEach(input => {
      input.disabled = !selected;
    });
  });

  const titles = {
    register: 'Welcome to your ultimate learning <span class="orange-text">Rath.</span>',
    studentLogin: "Welcome back.",
    adminLogin: "Administrator access."
  };

  const descriptions = {
    register: "Register as a student to explore and enrol in courses.",
    studentLogin: "Log in to access your student account and courses.",
    adminLogin: "Log in using your authorised administrator account."
  };

  const buttons = {
    register: "Register ↗",
    studentLogin: "Student Login ↗",
    adminLogin: "Admin Login ↗"
  };

  modalTitle.innerHTML = titles[mode];
  modalDescription.textContent = descriptions[mode];
  formSubmit.textContent = buttons[mode];

  document.querySelectorAll(".auth-tab").forEach(tab => {
    const selected = tab.dataset.mode === mode;

    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
}

document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    setAuthMode(tab.dataset.mode);
  });
});

modal.addEventListener("click", event => {
  if (event.target === modal) closeAuth();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && modal.classList.contains("show")) {
    closeAuth();
  }
});

function showAuthMessage(message, type = "error") {
  authMessage.textContent = message;
  authMessage.className = `auth-message ${type}`;
  authMessage.hidden = false;
}


/* PASSWORD SHOW / HIDE */

document.querySelectorAll(".password-toggle").forEach(button => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.target);
    const visible = input.type === "password";

    input.type = visible ? "text" : "password";
    button.textContent = visible ? "Hide" : "Show";
    button.setAttribute("aria-label", visible ? "Hide password" : "Show password");
    button.setAttribute("aria-pressed", String(visible));
  });
});

function togglePassword(id, button) {
  const input = document.getElementById(id);
  const visible = input.type === "password";

  input.type = visible ? "text" : "password";
  button.textContent = visible ? "Hide" : "Show";

  button.setAttribute(
    "aria-label",
    visible ? "Hide password" : "Show password"
  );

  button.setAttribute("aria-pressed", String(visible));
}
// =============================================
// 6. REGISTER, STUDENT LOGIN AND ADMIN LOGIN
// =============================================

async function handleStudentRegister(formData) {
  const data = await apiRequest("/auth/register", {
    method: "POST",
    auth: false,
    body: {
      name: formData.get("name").trim(),
      department: formData.get("department").trim(),
      email: formData.get("email").trim().toLowerCase(),
      password: formData.get("password")
    }
  });

  if (data.user?.role !== "student") {
    throw new APIError("Unable to verify student access.", 403);
  }

  await completeLogin(data);
}

async function handleStudentLogin(formData) {
  const data = await apiRequest("/auth/login", {
    method: "POST",
    auth: false,
    body: {
      email: formData.get("email").trim().toLowerCase(),
      password: formData.get("password")
    }
  });

  if (data.user?.role !== "student") {
    throw new APIError(
      "This account is not registered as a student.",
      403
    );
  }

  await completeLogin(data);
}

async function handleAdminLogin(formData) {
  const data = await apiRequest("/auth/login", {
    method: "POST",
    auth: false,
    body: {
      email: formData.get("email").trim().toLowerCase(),
      password: formData.get("password")
    }
  });

  if (data.user?.role !== "admin") {
    throw new APIError(
      "This account does not have administrator access.",
      403
    );
  }

  await completeLogin(data);
}

async function completeLogin(data) {
  if (!data.access_token || !data.refresh_token || !data.user) {
    throw new APIError("Invalid authentication response.", 500);
  }

  saveSession(data);
  closeAuth();

  await showDashboard();
}

authForm.addEventListener("submit", async event => {
  event.preventDefault();

  if (!authForm.reportValidity()) return;

  const formData = new FormData(authForm);
  const originalLabel = formSubmit.textContent;

  formSubmit.disabled = true;
  formSubmit.textContent = "Please wait...";

  try {
    if (currentMode === "register") {
      await handleStudentRegister(formData);
    } else if (currentMode === "studentLogin") {
      await handleStudentLogin(formData);
    } else {
      await handleAdminLogin(formData);
    }

  } catch (error) {
    showAuthMessage(error.message);

  } finally {
    formSubmit.disabled = false;
    formSubmit.textContent = originalLabel;
  }
});


// =============================================
// 7. COMMON HELPERS
// =============================================

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString();
}

function showNotice(message, type = "success") {
  const notice = document.getElementById("dashboardNotice");

  if (!notice) return;

  notice.textContent = message;
  notice.className = `dashboard-notice ${type}`;
  notice.hidden = false;
}

function statCard(label, value) {
  return `
    <div class="dashboard-stat">
      <span>${escapeHTML(label)}</span>
      <strong>${escapeHTML(value)}</strong>
    </div>
  `;
}

function renderTable(headers, rows) {
  if (!rows.length) {
    return `<p class="dashboard-empty">No records available yet.</p>`;
  }

  return `
    <div class="dashboard-table-wrapper">
      <table class="dashboard-table">
        <thead>
          <tr>${headers.map(h => `<th>${escapeHTML(h)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>${row.map(cell => `<td>${escapeHTML(cell)}</td>`).join("")}</tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}


// =============================================
// 8. DASHBOARD LAYOUT
// =============================================

const main = document.querySelector("main");

const landingSections = [...main.children];

const dashboardRoot = document.createElement("section");
dashboardRoot.id = "dashboardRoot";
dashboardRoot.className = "dashboard-section";
dashboardRoot.hidden = true;

dashboardRoot.innerHTML = `
  <div class="dashboard-heading">
    <div>
      <span class="eyebrow">PREATION EDUVERSITY</span>
      <h1 id="dashboardWelcome">Welcome</h1>
      <p id="dashboardSubtitle"></p>
    </div>

    <div class="dashboard-header-actions">
      <button type="button" class="secondary-btn" id="dashboardRefresh">
        Refresh ↻
      </button>
      <button type="button" class="primary-btn" id="dashboardLogout">
        Logout
      </button>
    </div>
  </div>

  <div id="dashboardNotice" class="dashboard-notice" hidden></div>

  <div id="dashboardTabs" class="dashboard-tabs" hidden>
    <button type="button" data-admin-view="overview">Overview</button>
    <button type="button" data-admin-view="courses">Courses</button>
    <button type="button" data-admin-view="students">Students</button>
    <button type="button" data-admin-view="enrollments">Enrollments</button>
  </div>

  <div id="dashboardContent"></div>
`;

main.appendChild(dashboardRoot);

const nav = document.querySelector(".navbar nav");
const navRegister = document.querySelector(".nav-register");

function showDashboardLayout() {
  landingSections.forEach(section => {
    section.hidden = true;
  });

  dashboardRoot.hidden = false;

  if (nav) nav.hidden = true;
  if (navRegister) navRegister.hidden = true;
}

function showLandingLayout() {
  dashboardRoot.hidden = true;

  landingSections.forEach(section => {
    section.hidden = false;
  });

  if (nav) nav.hidden = false;
  if (navRegister) navRegister.hidden = false;
}


// =============================================
// 9. DASHBOARD INITIALIZATION
// =============================================

async function showDashboard() {
  if (!session?.user) return;

  showDashboardLayout();

  const user = session.user;
  const role = user.role;
  const name = user.profile?.name || user.email || "User";

  document.getElementById("dashboardWelcome").textContent =
    `Welcome, ${name}`;

  document.getElementById("dashboardSubtitle").textContent =
    role === "admin"
      ? "Manage courses, students and enrollments."
      : "Explore courses and manage your learning journey.";

  document.getElementById("dashboardTabs").hidden = role !== "admin";

  if (role === "admin") {
    currentAdminView = "overview";
    await loadAdminView("overview");
  } else if (role === "student") {
    await loadStudentDashboard();
  } else {
    logout();
  }
}


// =============================================
// 10. ADMIN DASHBOARD
// =============================================

dashboardRoot.addEventListener("click", async event => {
  const tab = event.target.closest("[data-admin-view]");

  if (tab) {
    await loadAdminView(tab.dataset.adminView);
    return;
  }

  if (event.target.closest("#dashboardRefresh")) {
    await refreshDashboard();
    return;
  }

  if (event.target.closest("#dashboardLogout")) {
    logout();
    return;
  }

  const deactivate = event.target.closest("[data-deactivate-course]");

  if (deactivate) {
    await deactivateCourse(Number(deactivate.dataset.deactivateCourse));
  }
});

async function loadAdminView(view) {
  currentAdminView = view;

  document.querySelectorAll("[data-admin-view]").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.adminView === view);
  });

  const content = document.getElementById("dashboardContent");
  content.innerHTML = `<p class="dashboard-loading">Loading...</p>`;

  try {
    if (view === "overview") {
      const data = await apiRequest("/admin/dashboard");
      renderAdminOverview(data.statistics);
    }

    if (view === "courses") {
      const data = await apiRequest("/admin/courses");
      adminCourseCache = data.courses || [];
      renderAdminCourses(adminCourseCache);
    }

    if (view === "students") {
      const data = await apiRequest("/admin/students");
      renderAdminStudents(data.students || []);
    }

    if (view === "enrollments") {
      const data = await apiRequest("/admin/enrollments");
      renderAdminEnrollments(data.enrollments || []);
    }

  } catch (error) {
    content.textContent = error.message;
  }
}

function renderAdminOverview(stats) {
  const content = document.getElementById("dashboardContent");

  content.innerHTML = `
    <h2>Administration Overview</h2>
    <div class="dashboard-stats">
      ${statCard("Total courses", stats.total_courses)}
      ${statCard("Active courses", stats.active_courses)}
      ${statCard("Inactive courses", stats.inactive_courses)}
      ${statCard("Total students", stats.total_students)}
      ${statCard("Total enrollments", stats.total_enrollments)}
      ${statCard("Active enrollments", stats.active_enrollments)}
    </div>
  `;
}

function renderAdminCourses(courses) {
  const content = document.getElementById("dashboardContent");

  content.innerHTML = `
    <h2>Course Management</h2>

    <details class="dashboard-form-panel">
      <summary>Add a new course +</summary>

      <form id="createCourseForm" class="dashboard-form">
        <label>Course code
          <input name="code" maxlength="20" required>
        </label>

        <label>Course title
          <input name="title" maxlength="150" required>
        </label>

        <label>Department
          <input name="department" maxlength="100" required>
        </label>

        <label>Credits
          <input name="credits" type="number" min="1" required>
        </label>

        <label>Capacity
          <input name="capacity" type="number" min="0" required>
        </label>

        <label>Schedule
          <input name="schedule" maxlength="200">
        </label>

        <label>Prerequisites
          <input name="prerequisites" maxlength="500">
        </label>

        <button type="submit" class="primary-btn">Create Course</button>
      </form>
    </details>

    <h3>All Courses (${courses.length})</h3>

    <div class="dashboard-course-list">
      ${courses.length ? courses.map(course => `
        <article class="dashboard-course-card">
          <div>
            <span class="course-tag">${escapeHTML(course.code)}</span>
            <h3>${escapeHTML(course.title)}</h3>
            <p>${escapeHTML(course.department)}</p>
            <small>
              ${escapeHTML(course.credits)} credits ·
              Capacity: ${escapeHTML(course.capacity)} ·
              ${course.active ? "Active" : "Inactive"}
            </small>
          </div>

          <details>
            <summary>Edit course</summary>

            <form class="dashboard-form edit-course-form"
              data-course-id="${Number(course.course_id)}">

              <label>Course code
                <input name="code" value="${escapeHTML(course.code)}" required>
              </label>

              <label>Title
                <input name="title" value="${escapeHTML(course.title)}" required>
              </label>

              <label>Department
                <input name="department" value="${escapeHTML(course.department)}" required>
              </label>

              <label>Credits
                <input name="credits" type="number" min="1"
                  value="${Number(course.credits)}" required>
              </label>

              <label>Capacity
                <input name="capacity" type="number" min="0"
                  value="${Number(course.capacity)}" required>
              </label>

              <label>Schedule
                <input name="schedule" value="${escapeHTML(course.schedule || "")}">
              </label>

              <label>Prerequisites
                <input name="prerequisites"
                  value="${escapeHTML(course.prerequisites || "")}">
              </label>

              <label class="dashboard-checkbox">
                <input name="active" type="checkbox"
                  ${course.active ? "checked" : ""}>
                Course active
              </label>

              <button type="submit" class="primary-btn">Save Changes</button>
            </form>
          </details>

          ${course.active ? `
            <button type="button" class="secondary-btn"
              data-deactivate-course="${Number(course.course_id)}">
              Deactivate
            </button>
          ` : ""}
        </article>
      `).join("") : `<p class="dashboard-empty">No courses available.</p>`}
    </div>
  `;

  document.getElementById("createCourseForm")
    .addEventListener("submit", createCourse);

  document.querySelectorAll(".edit-course-form").forEach(form => {
    form.addEventListener("submit", updateCourse);
  });
}

async function createCourse(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const data = new FormData(form);

  const payload = {
    code: data.get("code").trim(),
    title: data.get("title").trim(),
    department: data.get("department").trim(),
    credits: Number(data.get("credits")),
    capacity: Number(data.get("capacity")),
    schedule: data.get("schedule").trim(),
    prerequisites: data.get("prerequisites").trim(),
    active: true
  };

  try {
    await apiRequest("/courses", {
      method: "POST",
      body: payload
    });

    showNotice("Course created successfully.");
    await loadAdminView("courses");

  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function updateCourse(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const courseId = Number(form.dataset.courseId);
  const original = adminCourseCache.find(
    course => course.course_id === courseId
  );

  if (!original) return;

  const data = new FormData(form);
  const payload = {};

  const fieldsToCompare = [
    "code",
    "title",
    "department",
    "credits",
    "capacity",
    "schedule",
    "prerequisites"
  ];

  fieldsToCompare.forEach(field => {
    const value = data.get(field);
    const next = ["credits", "capacity"].includes(field)
      ? Number(value)
      : value.trim();

    const previous = original[field] ?? "";

    if (String(next) !== String(previous)) {
      payload[field] = next;
    }
  });

  const active = data.has("active");

  if (active !== original.active) {
    payload.active = active;
  }

  if (!Object.keys(payload).length) {
    showNotice("No changes to save.", "error");
    return;
  }

  try {
    await apiRequest(`/admin/courses/${courseId}`, {
      method: "PATCH",
      body: payload
    });

    showNotice("Course updated successfully.");
    await loadAdminView("courses");

  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function deactivateCourse(courseId) {
  if (!confirm("Deactivate this course? It will no longer be available for new enrollment.")) {
    return;
  }

  try {
    await apiRequest(`/admin/courses/${courseId}`, {
      method: "PATCH",
      body: { active: false }
    });

    showNotice("Course deactivated successfully.");
    await loadAdminView("courses");

  } catch (error) {
    showNotice(error.message, "error");
  }
}

function renderAdminStudents(students) {
  const rows = students.map(student => [
    student.name,
    student.email,
    student.department,
    formatDate(student.created_at)
  ]);

  document.getElementById("dashboardContent").innerHTML = `
    <h2>Registered Students (${students.length})</h2>
    ${renderTable(
      ["Name", "Email", "Department", "Registered"],
      rows
    )}
  `;
}

function renderAdminEnrollments(enrollments) {
  const rows = enrollments.map(item => [
    item.id,
    item.student_id,
    item.course_id,
    formatDate(item.enrollment_date),
    item.status
  ]);

  document.getElementById("dashboardContent").innerHTML = `
    <h2>Enrollment Records (${enrollments.length})</h2>
    ${renderTable(
      ["ID", "Student ID", "Course ID", "Date", "Status"],
      rows
    )}
  `;
}


// =============================================
// 11. STUDENT DASHBOARD
// =============================================

async function loadStudentDashboard() {
  const content = document.getElementById("dashboardContent");
  content.innerHTML = `<p class="dashboard-loading">Loading...</p>`;

  try {
    const [dashboard, catalogue] = await Promise.all([
      apiRequest("/student/dashboard"),
      apiRequest("/courses", { auth: false })
    ]);

    renderStudentDashboard(
      dashboard,
      catalogue.courses || []
    );

  } catch (error) {
    content.textContent = error.message;
  }
}

function renderStudentDashboard(dashboard, courses) {
  const content = document.getElementById("dashboardContent");
  const stats = dashboard.statistics;
  const myCourses = dashboard.my_courses || [];

  const activeEnrollments = myCourses.filter(
    item => item.enrollment.status === "active"
  );

  const enrolledIds = new Set(
    activeEnrollments.map(item => item.enrollment.course_id)
  );

  content.innerHTML = `
    <h2>My Learning Overview</h2>

    <div class="dashboard-stats">
      ${statCard("Total enrollments", stats.total_enrollments)}
      ${statCard("Active courses", stats.active_enrollments)}
      ${statCard("Completed", stats.completed_courses)}
      ${statCard("Dropped", stats.dropped_courses)}
    </div>

    <h2>Explore Available Courses</h2>

    <input
      type="search"
      id="courseSearch"
      class="dashboard-search"
      placeholder="Search by course name, code or department..."
      aria-label="Search available courses"
    >

    <div id="studentCourseCatalogue" class="dashboard-course-list"></div>

    <h2>My Courses</h2>

    <div class="dashboard-course-list">
      ${myCourses.length ? myCourses.map(item => `
        <article class="dashboard-course-card">
          <div>
            <span class="course-tag">
              ${escapeHTML(item.course?.code || `Course ${item.enrollment.course_id}`)}
            </span>

            <h3>${escapeHTML(item.course?.title || "Course information unavailable")}</h3>

            <p>Status: ${escapeHTML(item.enrollment.status)}</p>

            <small>Enrolled: ${formatDate(item.enrollment.enrollment_date)}</small>
          </div>

          ${item.enrollment.status === "active" ? `
            <button type="button" class="secondary-btn"
              data-drop-course="${Number(item.enrollment.course_id)}">
              Drop Course
            </button>
          ` : ""}
        </article>
      `).join("") : `
        <p class="dashboard-empty">You have not enrolled in any courses yet.</p>
      `}
    </div>
  `;

  renderStudentCatalogue(courses, enrolledIds);

  document.getElementById("courseSearch")
    .addEventListener("input", event => {
      const search = event.target.value.toLowerCase();

      const filtered = courses.filter(course =>
        `${course.code} ${course.title} ${course.department}`
          .toLowerCase()
          .includes(search)
      );

      renderStudentCatalogue(filtered, enrolledIds);
    });

  content.querySelectorAll("[data-drop-course]").forEach(button => {
    button.addEventListener("click", () => {
      dropEnrollment(Number(button.dataset.dropCourse));
    });
  });
}

function renderStudentCatalogue(courses, enrolledIds) {
  const container = document.getElementById("studentCourseCatalogue");
  if (!container) return;

  if (!courses.length) {
    container.innerHTML = `
      <p class="dashboard-empty">No matching active courses found.</p>
    `;
    return;
  }

  container.innerHTML = courses.map(course => `
    <article class="dashboard-course-card">
      <div>
        <span class="course-tag">${escapeHTML(course.code)}</span>
        <h3>${escapeHTML(course.title)}</h3>
        <p>${escapeHTML(course.department)}</p>
        <small>
          ${escapeHTML(course.credits)} credits ·
          Capacity: ${escapeHTML(course.capacity)}
        </small>
      </div>

      <button type="button" class="primary-btn"
        data-enroll-course="${Number(course.course_id)}"
        ${enrolledIds.has(course.course_id) ? "disabled" : ""}>
        ${enrolledIds.has(course.course_id) ? "Already Enrolled" : "Enroll ↗"}
      </button>
    </article>
  `).join("");

  container.querySelectorAll("[data-enroll-course]").forEach(button => {
    button.addEventListener("click", () => {
      enrollInCourse(Number(button.dataset.enrollCourse));
    });
  });
}

async function enrollInCourse(courseId) {
  try {
    const result = await apiRequest(`/courses/${courseId}/enroll`, {
      method: "POST"
    });

    showNotice(result.message || "Enrollment successful.");
    await loadStudentDashboard();

  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function dropEnrollment(courseId) {
  if (!confirm("Are you sure you want to drop this course?")) return;

  try {
    const result = await apiRequest(
      `/student/enrollments/${courseId}`,
      { method: "DELETE" }
    );

    showNotice(result.message || "Course dropped successfully.");
    await loadStudentDashboard();

  } catch (error) {
    showNotice(error.message, "error");
  }
}


// =============================================
// 12. DASHBOARD REFRESH AND LOGOUT
// =============================================

async function refreshDashboard() {
  if (session?.user?.role === "admin") {
    await loadAdminView(currentAdminView);
  } else if (session?.user?.role === "student") {
    await loadStudentDashboard();
  }
}

function logout() {
  clearSession();
  showLandingLayout();
  openAuth("studentLogin");
}


// =============================================
// 13. PUBLIC COURSE SLIDER
// =============================================

const courseSlider = document.getElementById("courseSlider");
const previousButton = document.getElementById("previousCourse");
const nextButton = document.getElementById("nextCourse");

function renderCourses(courses = []) {
  courseSlider.innerHTML = "";

  if (!courses.length) {
    courseSlider.innerHTML = `
      <div class="empty-courses">
        <div class="empty-icon">✦</div>
        <h3>Something exciting is coming.</h3>
        <p>Our course catalogue will appear here soon.</p>
      </div>
    `;

    updateSliderButtons();
    return;
  }

  courses.forEach(course => {
    const card = document.createElement("article");
    card.className = "course-card";

    const tag = document.createElement("span");
    tag.className = "course-tag";
    tag.textContent = course.code || "COURSE";

    const title = document.createElement("h3");
    title.textContent = course.title || "Untitled Course";

    const description = document.createElement("p");
    description.textContent =
      course.department || "Explore this course.";

    const details = document.createElement("div");
    details.className = "course-details";
    details.textContent =
      `${course.credits ?? "—"} Credits · Capacity: ${course.capacity ?? "—"}`;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Register to Enrol ↗";
    button.addEventListener("click", () => {
      if (session?.user?.role === "student") {
        enrollInCourse(Number(course.course_id));
      } else if (session?.user?.role === "admin") {
        showDashboard();
      } else {
        openAuth("register");
      }
    });

    card.append(tag, title, description, details, button);
    courseSlider.appendChild(card);
  });

  updateSliderButtons();
}

async function loadPublicCourses() {
  try {
    const data = await apiRequest("/courses", { auth: false });
    renderCourses(data.courses || []);
  } catch (error) {
    renderCourses([]);
    console.error("Course catalogue:", error.message);
  }
}

previousButton.addEventListener("click", () => {
  courseSlider.scrollBy({ left: -320, behavior: "smooth" });
});

nextButton.addEventListener("click", () => {
  courseSlider.scrollBy({ left: 320, behavior: "smooth" });
});

function updateSliderButtons() {
  const canScroll =
    courseSlider.scrollWidth > courseSlider.clientWidth + 5;

  previousButton.disabled =
    !canScroll || courseSlider.scrollLeft <= 5;

  nextButton.disabled =
    !canScroll ||
    courseSlider.scrollLeft + courseSlider.clientWidth >=
    courseSlider.scrollWidth - 5;
}

courseSlider.addEventListener("scroll", updateSliderButtons);
window.addEventListener("resize", updateSliderButtons);


// =============================================
// 14. ASK ME HELPER
// =============================================

const askButton = document.getElementById("askButton");
const askMessage = document.getElementById("askMessage");
const askArea = document.querySelector(".ask-me-area");

askButton.addEventListener("click", () => {
  askMessage.hidden = !askMessage.hidden;
  askButton.setAttribute("aria-expanded", String(!askMessage.hidden));
});

document.addEventListener("click", event => {
  if (!askArea.contains(event.target)) {
    askMessage.hidden = true;
    askButton.setAttribute("aria-expanded", "false");
  }
});


// =============================================
// 15. INITIALIZE APPLICATION
// =============================================

async function initializeApp() {
  await loadPublicCourses();

  if (session?.access_token) {
    try {
      const account = await apiRequest("/auth/me");

      session.user = account;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));

      await showDashboard();
      return;

    } catch (error) {
      if (error.status === 0) {
        console.warn("Backend unavailable. Saved session retained.");
      } else {
        clearSession();
      }
    }
  }

  showLandingLayout();

  // Preserve the existing welcome registration popup.
  if (!session) {
    setTimeout(() => openAuth("register"), 700);
  }
}

initializeApp();
