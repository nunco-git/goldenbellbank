import { auth, googleProvider, db, storage, BOOTSTRAP_ADMIN_EMAILS } from "./firebase-config.js";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  getCountFromServer,
  serverTimestamp,
  increment,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

// ------------------------------------------------------------------
// 전역 상태
// ------------------------------------------------------------------
let currentUser = null;
let isAdmin = false;
let books = []; // {id, title, author, translator, publisher}
let selectedPhotoFile = null;
let mcqChoiceCount = 0;
let gbQueue = [];
let gbIndex = 0;
let correctionModalQuestionId = null;
let allUsers = {}; // uid -> {name}

// 등급 기준 (문제 등록 수 기준, 낮은 것부터 순서대로) - 페이지 표시용, 권한 연동은 추후 설정
const TIERS = [
  { name: "골드1", min: 80, cls: "tier-gold" },
  { name: "골드2", min: 60, cls: "tier-gold" },
  { name: "골드3", min: 40, cls: "tier-gold" },
  { name: "실버1", min: 30, cls: "tier-silver" },
  { name: "실버2", min: 20, cls: "tier-silver" },
  { name: "실버3", min: 15, cls: "tier-silver" },
  { name: "브론즈1", min: 10, cls: "tier-bronze" },
  { name: "브론즈2", min: 6, cls: "tier-bronze" },
  { name: "브론즈3", min: 3, cls: "tier-bronze" },
  { name: "일반", min: 0, cls: "tier-normal" },
];
function getTier(count) {
  return TIERS.find((t) => count >= t.min);
}

// ------------------------------------------------------------------
// 유틸
// ------------------------------------------------------------------
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.add("hidden"), 2500);
}

function correctionStatusLabel(status) {
  if (status === "applied") return '<span class="status-pill status-applied">반영됨</span>';
  return '<span class="status-pill status-pending">대기 중</span>';
}

function typeLabel(type) {
  return { mcq: "객관식", ox: "O/X", short: "주관식" }[type] || type;
}

function bookLabel(b) {
  return `${b.title} (${b.author}${b.translator ? " · " + b.translator + " 역" : ""}, ${b.publisher})`;
}

// ------------------------------------------------------------------
// 탭 네비게이션
// ------------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
});

// ------------------------------------------------------------------
// 인증
// ------------------------------------------------------------------
async function doGoogleLogin() {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (e) {
    toast("로그인 실패: " + e.message);
  }
}

document.getElementById("loginBtn").addEventListener("click", doGoogleLogin);
document.getElementById("landingLoginBtn").addEventListener("click", doGoogleLogin);

document.getElementById("logoutBtn").addEventListener("click", () => signOut(auth));

// ------------------------------------------------------------------
// 이메일 인증 로그인 (네이버메일 등 임의의 이메일 주소, 구글 계정 불필요)
// ------------------------------------------------------------------
const EMAIL_FOR_SIGNIN_KEY = "goldenbell_emailForSignIn";

function openEmailLoginModal() {
  document.getElementById("emailLoginInput").value = "";
  document.getElementById("emailLoginStatus").classList.add("hidden");
  document.getElementById("emailLoginModal").classList.remove("hidden");
}
document.getElementById("emailLoginBtn").addEventListener("click", openEmailLoginModal);
document.getElementById("landingEmailLoginBtn").addEventListener("click", openEmailLoginModal);
document.getElementById("emailLoginCancelBtn").addEventListener("click", () => {
  document.getElementById("emailLoginModal").classList.add("hidden");
});

// 네이버메일(@naver.com)만 허용
function isAllowedEmailDomain(email) {
  return /^[^\s@]+@naver\.com$/i.test(email);
}

document.getElementById("emailLoginSendBtn").addEventListener("click", async () => {
  const email = document.getElementById("emailLoginInput").value.trim();
  const status = document.getElementById("emailLoginStatus");
  status.classList.remove("hidden");
  if (!email || !email.includes("@")) {
    status.textContent = "올바른 이메일 주소를 입력해 주세요.";
    return;
  }
  if (!isAllowedEmailDomain(email)) {
    status.textContent = "네이버메일(@naver.com) 주소만 로그인할 수 있습니다.";
    return;
  }
  status.textContent = "인증 메일을 보내는 중입니다...";
  try {
    const actionCodeSettings = {
      url: window.location.origin + window.location.pathname,
      handleCodeInApp: true,
    };
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    window.localStorage.setItem(EMAIL_FOR_SIGNIN_KEY, email);
    status.textContent = `${email} 주소로 인증 메일을 보냈습니다. 메일함(스팸함 포함)에서 링크를 눌러주세요.`;
  } catch (err) {
    status.textContent = "메일 발송 실패: " + err.message;
  }
});

// 이메일 인증 링크를 타고 돌아온 경우 자동 로그인 처리
(async function completeEmailLinkSignInIfNeeded() {
  if (!isSignInWithEmailLink(auth, window.location.href)) return;
  let email = window.localStorage.getItem(EMAIL_FOR_SIGNIN_KEY);
  if (!email) {
    email = window.prompt("로그인에 사용할 네이버메일(@naver.com) 주소를 다시 입력해 주세요.");
  }
  if (!email) return;
  if (!isAllowedEmailDomain(email)) {
    toast("네이버메일(@naver.com) 주소만 로그인할 수 있습니다.");
    return;
  }
  try {
    await signInWithEmailLink(auth, email, window.location.href);
    window.localStorage.removeItem(EMAIL_FOR_SIGNIN_KEY);
    // 인증 파라미터가 남은 URL 정리
    window.history.replaceState({}, document.title, window.location.pathname);
    toast("이메일 인증으로 로그인되었습니다.");
  } catch (err) {
    toast("이메일 로그인 실패: " + err.message);
  }
})();

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) {
    isAdmin = false;
    document.getElementById("loginBtn").classList.remove("hidden");
    document.getElementById("emailLoginBtn").classList.remove("hidden");
    document.getElementById("userBox").classList.add("hidden");
    document.getElementById("tabNav").classList.add("hidden");
    document.getElementById("app").classList.add("hidden");
    document.getElementById("landing").classList.remove("hidden");
    return;
  }

  document.getElementById("landing").classList.add("hidden");

  // 사용자 문서 확인/생성
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    const bootstrapAdmin = BOOTSTRAP_ADMIN_EMAILS.includes(user.email);
    await setDoc(userRef, {
      email: user.email,
      name: user.displayName,
      role: bootstrapAdmin ? "admin" : "user",
      createdAt: serverTimestamp(),
    });
    isAdmin = bootstrapAdmin;
  } else {
    isAdmin = snap.data().role === "admin";
  }

  document.getElementById("loginBtn").classList.add("hidden");
  document.getElementById("emailLoginBtn").classList.add("hidden");
  document.getElementById("userBox").classList.remove("hidden");
  document.getElementById("userPhoto").classList.toggle("hidden", !user.photoURL);
  document.getElementById("userPhoto").src = user.photoURL || "";
  document.getElementById("userName").textContent = user.displayName || user.email;
  document.getElementById("adminBadge").classList.toggle("hidden", !isAdmin);
  document.getElementById("tabNav").classList.remove("hidden");
  document.getElementById("app").classList.remove("hidden");

  // 정정 내역 탭은 관리자만
  document.querySelector('.tab-btn[data-tab="corrections"]').classList.toggle("hidden", !isAdmin);

  initBooks();
  initMyQuestions();
  initBrowse();
  initRanking();
  initHome();
  if (isAdmin) initCorrectionsAdmin();
});

// ------------------------------------------------------------------
// 홈 대시보드
// ------------------------------------------------------------------
function initHome() {
  onSnapshot(collection(db, "books"), (snap) => {
    const el = document.getElementById("statBookCount");
    if (el) el.textContent = snap.size;
  });
  onSnapshot(collection(db, "questions"), (snap) => {
    const el = document.getElementById("statQuestionCount");
    if (el) el.textContent = snap.size;
    const authors = new Set();
    snap.forEach((d) => {
      if (d.data().authorUid) authors.add(d.data().authorUid);
    });
    const userEl = document.getElementById("statUserCount");
    if (userEl) userEl.textContent = authors.size;
  });
  onSnapshot(doc(db, "meta", "stats"), (snap) => {
    const el = document.getElementById("statGoldenbellCount");
    if (el) el.textContent = snap.exists() ? snap.data().goldenbellRuns || 0 : 0;
  });
}

async function recordGoldenbellRun() {
  try {
    await setDoc(doc(db, "meta", "stats"), { goldenbellRuns: increment(1) }, { merge: true });
  } catch {
    // 통계 기록 실패는 무시 (골든벨 진행 자체에는 영향 없음)
  }
}

// ------------------------------------------------------------------
// 도서 관리
// ------------------------------------------------------------------
document.getElementById("bookForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("bookTitle").value.trim();
  const author = document.getElementById("bookAuthor").value.trim();
  const translator = document.getElementById("bookTranslator").value.trim();
  const publisher = document.getElementById("bookPublisher").value.trim();
  if (!title || !author || !publisher) return;

  try {
    await addDoc(collection(db, "books"), {
      title,
      author,
      translator: translator || null,
      publisher,
      createdBy: currentUser.uid,
      createdByName: currentUser.displayName,
      createdAt: serverTimestamp(),
    });
    e.target.reset();
    toast("도서가 등록되었습니다.");
  } catch (err) {
    toast("등록 실패: " + err.message);
  }
});

function initBooks() {
  const q = query(collection(db, "books"), orderBy("title"));
  onSnapshot(q, async (snap) => {
    books = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    populateBookSelects();
    await renderBookList();
  });
}

function populateBookSelects() {
  const selects = [
    document.getElementById("qBookSelect"),
    document.getElementById("gbBookSelect"),
    document.getElementById("browseBookFilter"),
  ];
  selects.forEach((sel) => {
    const keepFirst = sel.id === "browseBookFilter";
    const currentVal = sel.value;
    sel.innerHTML = keepFirst ? '<option value="">전체 도서</option>' : "";
    books.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = bookLabel(b);
      sel.appendChild(opt);
    });
    if ([...sel.options].some((o) => o.value === currentVal)) sel.value = currentVal;
  });
}

async function renderBookList() {
  const filterText = document.getElementById("bookSearch").value.trim().toLowerCase();
  const list = document.getElementById("bookList");
  list.innerHTML = "";
  const filtered = books.filter(
    (b) =>
      !filterText ||
      b.title.toLowerCase().includes(filterText) ||
      b.author.toLowerCase().includes(filterText)
  );
  for (const b of filtered) {
    const div = document.createElement("div");
    div.className = "book-item";
    let countHtml = "";
    try {
      const cq = query(collection(db, "questions"), where("bookId", "==", b.id));
      const cs = await getCountFromServer(cq);
      countHtml = `<span class="qcount">등록 문제 ${cs.data().count}개</span>`;
    } catch {
      countHtml = "";
    }
    div.innerHTML = `
      <div>
        <div class="title">${b.title}</div>
        <div class="meta">${b.author}${b.translator ? " · " + b.translator + " 역" : ""} · ${b.publisher}</div>
      </div>
      ${countHtml}
    `;
    list.appendChild(div);
  }
}

document.getElementById("bookSearch").addEventListener("input", renderBookList);

// ------------------------------------------------------------------
// 문제 등록 - 사진 / OCR
// ------------------------------------------------------------------
document.getElementById("qPhoto").addEventListener("change", (e) => {
  selectedPhotoFile = e.target.files[0] || null;
  const preview = document.getElementById("qPhotoPreview");
  const ocrBtn = document.getElementById("ocrBtn");
  if (selectedPhotoFile) {
    preview.src = URL.createObjectURL(selectedPhotoFile);
    preview.classList.remove("hidden");
    ocrBtn.classList.remove("hidden");
  } else {
    preview.classList.add("hidden");
    ocrBtn.classList.add("hidden");
  }
});

document.getElementById("ocrBtn").addEventListener("click", async () => {
  if (!selectedPhotoFile || !window.Tesseract) return;
  const status = document.getElementById("ocrStatus");
  status.classList.remove("hidden");
  status.textContent = "텍스트를 읽는 중입니다... (시간이 걸릴 수 있어요)";
  try {
    const result = await window.Tesseract.recognize(selectedPhotoFile, "kor+eng", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          status.textContent = `텍스트를 읽는 중입니다... ${Math.round(m.progress * 100)}%`;
        }
      },
    });
    const text = result.data.text.trim();
    const qText = document.getElementById("qText");
    if (text) {
      qText.value = qText.value ? qText.value + "\n\n[사진에서 읽어온 텍스트]\n" + text : text;
      status.textContent = "텍스트를 읽어왔습니다. 필요하면 직접 수정해 주세요.";
    } else {
      status.textContent = "텍스트를 인식하지 못했습니다. 직접 입력해 주세요.";
    }
  } catch (err) {
    status.textContent = "OCR 처리 중 오류가 발생했습니다: " + err.message;
  }
});

// ------------------------------------------------------------------
// 문제 등록 - 유형별 입력 UI
// ------------------------------------------------------------------
function renderAnswerWrap() {
  const type = document.getElementById("qType").value;
  const wrap = document.getElementById("answerWrap");
  wrap.innerHTML = "";

  if (type === "mcq") {
    const sel = document.createElement("select");
    sel.id = "answerMcqSelect";
    sel.required = true;
    document.querySelectorAll("#mcqChoices .mcq-choice-row input[type=text]").forEach((input, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = `${i + 1}번: ${input.value || "(보기 " + (i + 1) + ")"}`;
      sel.appendChild(opt);
    });
    wrap.appendChild(sel);
  } else if (type === "ox") {
    wrap.innerHTML = `
      <div class="checkbox-row">
        <label><input type="radio" name="answerOx" value="O" checked /> O</label>
        <label><input type="radio" name="answerOx" value="X" /> X</label>
      </div>`;
  } else {
    const input = document.createElement("input");
    input.type = "text";
    input.id = "answerShortInput";
    input.placeholder = "정답을 입력하세요";
    input.required = true;
    wrap.appendChild(input);
  }

  // 정답 입력이 바뀔 때마다 같은 도서·같은 정답의 기존 문제를 확인
  if (type === "mcq") {
    document.getElementById("answerMcqSelect").addEventListener("change", checkDuplicateQuestions);
  } else if (type === "ox") {
    document.querySelectorAll('input[name="answerOx"]').forEach((r) => r.addEventListener("change", checkDuplicateQuestions));
  } else {
    document.getElementById("answerShortInput").addEventListener("input", debouncedCheckDuplicates);
  }
  checkDuplicateQuestions();
}

// ------------------------------------------------------------------
// 유사(중복) 문제 미리보기
// ------------------------------------------------------------------
function getCurrentAnswerValue(type) {
  if (type === "mcq") {
    const sel = document.getElementById("answerMcqSelect");
    if (!sel || sel.value === "") return "";
    const choices = [...document.querySelectorAll("#mcqChoices .mcq-choice-row input[type=text]")].map((i) => i.value.trim());
    return choices[parseInt(sel.value, 10)] || "";
  }
  if (type === "ox") {
    const checked = document.querySelector('input[name="answerOx"]:checked');
    return checked ? checked.value : "";
  }
  const input = document.getElementById("answerShortInput");
  return input ? input.value.trim() : "";
}

let dupCheckTimer = null;
function debouncedCheckDuplicates() {
  clearTimeout(dupCheckTimer);
  dupCheckTimer = setTimeout(checkDuplicateQuestions, 350);
}

async function checkDuplicateQuestions() {
  const box = document.getElementById("dupWarning");
  if (!box) return;
  const bookId = document.getElementById("qBookSelect").value;
  const type = document.getElementById("qType").value;
  const answer = getCurrentAnswerValue(type);

  if (!bookId || !answer) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }

  try {
    const snap = await getDocs(
      query(collection(db, "questions"), where("bookId", "==", bookId), where("answer", "==", answer))
    );
    if (snap.empty) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    const items = [];
    snap.forEach((d) => {
      const data = d.data();
      items.push(
        `<li>${escapeHtml(data.questionText)}${data.authorName ? " · " + escapeHtml(data.authorName) : ""}</li>`
      );
    });
    box.innerHTML = `
      <div class="dup-title">⚠️ 정답이 같은 기존 문제 ${items.length}건이 있어요. 중복이 아닌지 확인해 주세요.</div>
      <ul>${items.join("")}</ul>
    `;
    box.classList.remove("hidden");
  } catch {
    // 미리보기 조회 실패는 등록 자체를 막지 않음
  }
}

function addChoiceRow(value = "") {
  if (mcqChoiceCount >= 5) return;
  mcqChoiceCount++;
  const row = document.createElement("div");
  row.className = "mcq-choice-row";
  row.innerHTML = `
    <input type="text" placeholder="보기 ${mcqChoiceCount}" value="${value}" />
    <button type="button" title="삭제">✕</button>
  `;
  row.querySelector("input").addEventListener("input", () => {
    if (document.getElementById("qType").value === "mcq") renderAnswerWrap();
  });
  row.querySelector("button").addEventListener("click", () => {
    if (document.querySelectorAll("#mcqChoices .mcq-choice-row").length <= 2) {
      toast("보기는 최소 2개 이상이어야 합니다.");
      return;
    }
    row.remove();
    mcqChoiceCount = document.querySelectorAll("#mcqChoices .mcq-choice-row").length;
    renumberChoices();
    if (document.getElementById("qType").value === "mcq") renderAnswerWrap();
  });
  document.getElementById("mcqChoices").appendChild(row);
}

function renumberChoices() {
  document.querySelectorAll("#mcqChoices .mcq-choice-row input[type=text]").forEach((input, i) => {
    input.placeholder = `보기 ${i + 1}`;
  });
}

function resetChoices() {
  document.getElementById("mcqChoices").innerHTML = "";
  mcqChoiceCount = 0;
  addChoiceRow();
  addChoiceRow();
}

document.getElementById("addChoiceBtn").addEventListener("click", () => {
  addChoiceRow();
  if (document.getElementById("qType").value === "mcq") renderAnswerWrap();
});

document.getElementById("qType").addEventListener("change", () => {
  const type = document.getElementById("qType").value;
  document.getElementById("mcqChoicesWrap").classList.toggle("hidden", type !== "mcq");
  renderAnswerWrap();
});

document.getElementById("qBookSelect").addEventListener("change", checkDuplicateQuestions);

resetChoices();
renderAnswerWrap();

// ------------------------------------------------------------------
// 문제 등록 - 제출
// ------------------------------------------------------------------
document.getElementById("questionForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const bookId = document.getElementById("qBookSelect").value;
  const type = document.getElementById("qType").value;
  const questionText = document.getElementById("qText").value.trim();
  if (!bookId) {
    toast("도서를 선택해 주세요.");
    return;
  }
  if (!questionText) {
    toast("문제 내용을 입력해 주세요.");
    return;
  }

  let choices = null;
  let answer = null;

  if (type === "mcq") {
    choices = [...document.querySelectorAll("#mcqChoices .mcq-choice-row input[type=text]")]
      .map((i) => i.value.trim())
      .filter(Boolean);
    if (choices.length < 2) {
      toast("보기를 2개 이상 입력해 주세요.");
      return;
    }
    const idx = parseInt(document.getElementById("answerMcqSelect").value, 10);
    answer = choices[idx];
  } else if (type === "ox") {
    answer = document.querySelector('input[name="answerOx"]:checked').value;
  } else {
    answer = document.getElementById("answerShortInput").value.trim();
    if (!answer) {
      toast("정답을 입력해 주세요.");
      return;
    }
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = "등록 중...";

  try {
    let photoURL = null;
    const docRef = doc(collection(db, "questions"));
    if (selectedPhotoFile) {
      const sref = ref(storage, `questions/${bookId}/${docRef.id}.jpg`);
      await uploadBytes(sref, selectedPhotoFile);
      photoURL = await getDownloadURL(sref);
    }

    await setDoc(docRef, {
      bookId,
      type,
      questionText,
      choices,
      answer,
      photoURL,
      authorUid: currentUser.uid,
      authorName: document.getElementById("qAuthorName").value.trim() || null,
      authorAffil: document.getElementById("qAuthorAffil").value.trim() || null,
      authorAge: document.getElementById("qAuthorAge").value || null,
      createdAt: serverTimestamp(),
    });

    e.target.reset();
    selectedPhotoFile = null;
    document.getElementById("qPhotoPreview").classList.add("hidden");
    document.getElementById("ocrBtn").classList.add("hidden");
    document.getElementById("ocrStatus").classList.add("hidden");
    resetChoices();
    document.getElementById("mcqChoicesWrap").classList.remove("hidden");
    renderAnswerWrap();
    toast("문제가 등록되었습니다. 바로 골든벨에 사용됩니다.");
  } catch (err) {
    toast("등록 실패: " + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "문제 등록";
  }
});

// ------------------------------------------------------------------
// 내가 등록한 문제
// ------------------------------------------------------------------
function initMyQuestions() {
  const q = query(collection(db, "questions"), where("authorUid", "==", currentUser.uid), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    const list = document.getElementById("myQuestionList");
    list.innerHTML = "";
    snap.forEach((d) => {
      const data = d.data();
      const book = books.find((b) => b.id === data.bookId);
      const card = document.createElement("div");
      card.className = "question-card";
      card.innerHTML = `
        <div class="q-book">${book ? book.title : "(삭제된 도서)"}</div>
        <div class="q-text">${escapeHtml(data.questionText)}</div>
        ${data.choices ? `<div class="q-choices">${data.choices.map((c, i) => `${i + 1}. ${escapeHtml(c)}`).join(" &nbsp; ")}</div>` : ""}
        <div class="q-answer">정답: ${escapeHtml(String(data.answer))}</div>
        ${data.photoURL ? `<img class="q-photo" src="${data.photoURL}" />` : ""}
        <div class="q-meta">${typeLabel(data.type)}</div>
        <div class="review-actions"><button class="btn btn-ghost small" data-del="${d.id}">삭제</button></div>
      `;
      card.querySelector("[data-del]")?.addEventListener("click", async () => {
        if (confirm("이 문제를 삭제할까요?")) {
          await deleteDoc(doc(db, "questions", d.id));
          toast("삭제되었습니다.");
        }
      });
      list.appendChild(card);
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ------------------------------------------------------------------
// 문제 둘러보기 (전체 이용자) - 오류 신고 / 동의 투표
// ------------------------------------------------------------------
function initBrowse() {
  document.getElementById("browseBookFilter").addEventListener("change", renderBrowseList);
  onSnapshot(collection(db, "questions"), () => renderBrowseList());
  onSnapshot(collection(db, "corrections"), () => {
    renderBrowseList();
    if (isAdmin) renderCorrectionAdminList();
  });
}

async function renderBrowseList() {
  const bookId = document.getElementById("browseBookFilter").value;
  const constraints = bookId ? [where("bookId", "==", bookId)] : [];
  constraints.push(orderBy("createdAt", "desc"));
  const snap = await getDocs(query(collection(db, "questions"), ...constraints));

  const list = document.getElementById("browseList");
  list.innerHTML = "";
  if (snap.empty) {
    list.innerHTML = '<p class="hint">등록된 문제가 없습니다.</p>';
    return;
  }

  // 문제별 대기 중인 정정 요청 조회
  const corrSnap = await getDocs(query(collection(db, "corrections"), where("status", "==", "pending")));
  const correctionsByQuestion = {};
  corrSnap.forEach((d) => {
    const data = d.data();
    (correctionsByQuestion[data.questionId] ||= []).push({ id: d.id, ...data });
  });

  snap.forEach((d) => {
    const data = d.data();
    const book = books.find((b) => b.id === data.bookId);
    const card = document.createElement("div");
    card.className = "question-card";
    card.innerHTML = `
      <div class="q-book">${book ? book.title : "(삭제된 도서)"}</div>
      <div class="q-text">${escapeHtml(data.questionText)}</div>
      ${data.choices ? `<div class="q-choices">${data.choices.map((c, i) => `${i + 1}. ${escapeHtml(c)}`).join(" &nbsp; ")}</div>` : ""}
      <div class="q-answer">정답: ${escapeHtml(String(data.answer))}</div>
      ${data.photoURL ? `<img class="q-photo" src="${data.photoURL}" />` : ""}
      <div class="q-meta">
        ${typeLabel(data.type)}
        ${data.authorName ? " · 등록자: " + escapeHtml(data.authorName) : ""}
      </div>
      <div class="review-actions">
        <button class="btn btn-ghost small" data-report="${d.id}">오류 신고</button>
      </div>
      <div class="corrections-wrap"></div>
    `;
    card.querySelector("[data-report]").addEventListener("click", () => openCorrectionModal(d.id));

    const corrWrap = card.querySelector(".corrections-wrap");
    (correctionsByQuestion[d.id] || []).forEach((c) => {
      corrWrap.appendChild(renderCorrectionItem(c, data));
    });

    list.appendChild(card);
  });
}

function renderCorrectionItem(c, questionData) {
  const div = document.createElement("div");
  div.className = "correction-item";
  const diffs = [];
  if (c.proposedQuestionText) diffs.push(`문제 내용 → <b>${escapeHtml(c.proposedQuestionText)}</b>`);
  if (c.proposedAnswer) diffs.push(`정답 → <b>${escapeHtml(c.proposedAnswer)}</b>`);
  const votes = c.votes || [];
  const alreadyVoted = currentUser && votes.includes(currentUser.uid);
  const isProposer = currentUser && c.proposerUid === currentUser.uid;
  div.innerHTML = `
    <div class="corr-reason">🚩 ${escapeHtml(c.reason)}</div>
    ${diffs.length ? `<div class="corr-diff">${diffs.join(" · ")}</div>` : ""}
    <div class="corr-meta">신고자: ${escapeHtml(c.proposerName || "익명")} · 동의 ${votes.length}/2</div>
    <div class="corr-actions">
      ${
        isProposer
          ? `<span class="hint">내가 등록한 신고입니다</span>`
          : alreadyVoted
          ? `<span class="hint">동의하셨습니다</span>`
          : `<button class="btn btn-ghost small" data-agree="${c.id}">동의</button>`
      }
    </div>
  `;
  const agreeBtn = div.querySelector("[data-agree]");
  if (agreeBtn) {
    agreeBtn.addEventListener("click", () => agreeCorrection(c, questionData));
  }
  return div;
}

async function agreeCorrection(c, questionData) {
  if (!currentUser) return;
  const corrRef = doc(db, "corrections", c.id);
  const votes = [...(c.votes || [])];
  if (votes.includes(currentUser.uid) || c.proposerUid === currentUser.uid) return;
  votes.push(currentUser.uid);

  if (votes.length >= 2) {
    // 2명 이상 동의 -> 원본 문제에 반영
    const updates = {};
    if (c.proposedQuestionText) updates.questionText = c.proposedQuestionText;
    if (c.proposedAnswer) updates.answer = c.proposedAnswer;
    if (Object.keys(updates).length > 0) {
      await updateDoc(doc(db, "questions", c.questionId), updates);
    }
    await updateDoc(corrRef, { votes, status: "applied", appliedAt: serverTimestamp() });
    toast("정정 요청이 반영되었습니다.");
  } else {
    await updateDoc(corrRef, { votes });
    toast("동의했습니다.");
  }
}

// ------------------------------------------------------------------
// 오류 신고(수정 제안) 모달
// ------------------------------------------------------------------
function openCorrectionModal(questionId) {
  correctionModalQuestionId = questionId;
  document.getElementById("corrReason").value = "";
  document.getElementById("corrQuestionText").value = "";
  document.getElementById("corrAnswer").value = "";
  document.getElementById("correctionModal").classList.remove("hidden");
}

document.getElementById("corrCancelBtn").addEventListener("click", () => {
  document.getElementById("correctionModal").classList.add("hidden");
});

document.getElementById("corrSubmitBtn").addEventListener("click", async () => {
  const reason = document.getElementById("corrReason").value.trim();
  if (!reason) {
    toast("신고 사유를 입력해 주세요.");
    return;
  }
  const qSnap = await getDoc(doc(db, "questions", correctionModalQuestionId));
  if (!qSnap.exists()) {
    toast("문제를 찾을 수 없습니다.");
    return;
  }
  try {
    await addDoc(collection(db, "corrections"), {
      questionId: correctionModalQuestionId,
      bookId: qSnap.data().bookId,
      reason,
      proposedQuestionText: document.getElementById("corrQuestionText").value.trim() || null,
      proposedAnswer: document.getElementById("corrAnswer").value.trim() || null,
      proposerUid: currentUser.uid,
      proposerName: currentUser.displayName,
      votes: [],
      status: "pending",
      createdAt: serverTimestamp(),
    });
    document.getElementById("correctionModal").classList.add("hidden");
    toast("오류 신고가 등록되었습니다. 다른 이용자 2명 이상 동의 시 반영됩니다.");
  } catch (err) {
    toast("등록 실패: " + err.message);
  }
});

// ------------------------------------------------------------------
// 정정 내역 (관리자)
// ------------------------------------------------------------------
function initCorrectionsAdmin() {
  document.getElementById("correctionStatusFilter").addEventListener("change", renderCorrectionAdminList);
  renderCorrectionAdminList();
}

async function renderCorrectionAdminList() {
  const list = document.getElementById("correctionAdminList");
  if (!list) return;
  const status = document.getElementById("correctionStatusFilter").value;
  const constraints = [];
  if (status) constraints.push(where("status", "==", status));
  constraints.push(orderBy("createdAt", "desc"));
  const snap = await getDocs(query(collection(db, "corrections"), ...constraints));

  list.innerHTML = "";
  if (snap.empty) {
    list.innerHTML = '<p class="hint">정정 내역이 없습니다.</p>';
    return;
  }
  for (const d of snap.docs) {
    const c = d.data();
    const qSnap = await getDoc(doc(db, "questions", c.questionId));
    const qData = qSnap.exists() ? qSnap.data() : null;
    const book = qData ? books.find((b) => b.id === qData.bookId) : null;
    const card = document.createElement("div");
    card.className = "question-card";
    card.innerHTML = `
      <div class="q-book">${book ? book.title : "(삭제된 도서)"}</div>
      <div class="q-text">${qData ? escapeHtml(qData.questionText) : "(삭제된 문제)"}</div>
      <div class="correction-item">
        <div class="corr-reason">🚩 ${escapeHtml(c.reason)}</div>
        ${c.proposedQuestionText ? `<div class="corr-diff">문제 내용 → <b>${escapeHtml(c.proposedQuestionText)}</b></div>` : ""}
        ${c.proposedAnswer ? `<div class="corr-diff">정답 → <b>${escapeHtml(c.proposedAnswer)}</b></div>` : ""}
        <div class="corr-meta">
          신고자: ${escapeHtml(c.proposerName || "익명")} · 동의 ${(c.votes || []).length}명 · ${correctionStatusLabel(c.status)}
        </div>
      </div>
      <div class="review-actions">
        <button class="btn btn-ghost small" data-del-corr="${d.id}">삭제</button>
      </div>
    `;
    card.querySelector("[data-del-corr]").addEventListener("click", () => {
      if (confirm("이 정정 내역을 삭제할까요?")) {
        deleteDoc(doc(db, "corrections", d.id)).then(() => toast("삭제되었습니다."));
      }
    });
    list.appendChild(card);
  }
}

// ------------------------------------------------------------------
// 독서골든벨
// ------------------------------------------------------------------
document.getElementById("gbBookSelect").addEventListener("change", async () => {
  const bookId = document.getElementById("gbBookSelect").value;
  const info = document.getElementById("gbBookInfo");
  if (!bookId) {
    info.textContent = "";
    return;
  }
  const book = books.find((b) => b.id === bookId);
  const cq = query(collection(db, "questions"), where("bookId", "==", bookId));
  const cs = await getCountFromServer(cq);
  info.textContent = `${bookLabel(book)} — 등록된 문제 ${cs.data().count}개 보유`;
});

document.getElementById("gbStartBtn").addEventListener("click", async () => {
  const bookId = document.getElementById("gbBookSelect").value;
  if (!bookId) {
    toast("도서를 선택해 주세요.");
    return;
  }
  const count = parseInt(document.getElementById("gbCount").value, 10) || 10;
  const allowedTypes = [...document.querySelectorAll(".gbTypeFilter:checked")].map((c) => c.value);
  if (allowedTypes.length === 0) {
    toast("문제 유형을 하나 이상 선택해 주세요.");
    return;
  }

  const q = query(collection(db, "questions"), where("bookId", "==", bookId));
  const snap = await getDocs(q);
  let pool = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((qd) => allowedTypes.includes(qd.type));

  if (pool.length === 0) {
    toast("조건에 맞는 문제가 없습니다.");
    return;
  }

  // 셔플
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  gbQueue = pool.slice(0, Math.min(count, pool.length));
  gbIndex = 0;

  document.getElementById("gbQuiz").classList.remove("hidden");
  renderGbQuestion();
  recordGoldenbellRun();
});

function renderGbQuestion() {
  const card = document.getElementById("gbQuestionCard");
  const progress = document.getElementById("gbProgress");
  const revealBtn = document.getElementById("gbRevealBtn");
  const q = gbQueue[gbIndex];

  progress.textContent = `${gbIndex + 1} / ${gbQueue.length} 문제`;

  card.innerHTML = `
    <div class="gb-q-type">${typeLabel(q.type)}</div>
    <div class="gb-q-text">${escapeHtml(q.questionText)}</div>
    ${q.photoURL ? `<img class="gb-q-photo" src="${q.photoURL}" />` : ""}
    ${
      q.choices
        ? `<div class="gb-q-choices">${q.choices.map((c, i) => `<div>${i + 1}. ${escapeHtml(c)}</div>`).join("")}</div>`
        : ""
    }
    <div id="gbAnswerBox"></div>
  `;
  revealBtn.disabled = false;
  revealBtn.textContent = "정답 공개";
  document.getElementById("gbNextBtn").textContent = gbIndex === gbQueue.length - 1 ? "완료" : "다음 문제";
}

document.getElementById("gbRevealBtn").addEventListener("click", () => {
  const q = gbQueue[gbIndex];
  document.getElementById("gbAnswerBox").innerHTML = `<div class="gb-answer-box">정답: ${escapeHtml(String(q.answer))}</div>`;
  document.getElementById("gbRevealBtn").disabled = true;
});

document.getElementById("gbNextBtn").addEventListener("click", () => {
  if (gbIndex < gbQueue.length - 1) {
    gbIndex++;
    renderGbQuestion();
  } else {
    document.getElementById("gbQuiz").classList.add("hidden");
    toast("골든벨이 종료되었습니다.");
  }
});

document.getElementById("gbEndBtn").addEventListener("click", () => {
  document.getElementById("gbQuiz").classList.add("hidden");
});

// ------------------------------------------------------------------
// 랭킹 / 등급
// ------------------------------------------------------------------
function initRanking() {
  onSnapshot(collection(db, "questions"), () => renderRanking());
}

async function renderRanking() {
  const list = document.getElementById("rankingList");
  const myTierBox = document.getElementById("rankingMyTier");
  if (!list) return;

  const snap = await getDocs(collection(db, "questions"));
  const countByUid = {};
  const nameByUid = {};
  snap.forEach((d) => {
    const data = d.data();
    if (!data.authorUid) return;
    countByUid[data.authorUid] = (countByUid[data.authorUid] || 0) + 1;
    if (data.authorName) nameByUid[data.authorUid] = data.authorName;
  });

  // 이름 미입력자는 사용자 문서에서 표시 이름 보완
  const uids = Object.keys(countByUid);
  await Promise.all(
    uids.map(async (uid) => {
      if (nameByUid[uid]) return;
      if (uid === currentUser?.uid) {
        nameByUid[uid] = currentUser.displayName || "이름 없음";
        return;
      }
      try {
        const uSnap = await getDoc(doc(db, "users", uid));
        nameByUid[uid] = uSnap.exists() ? uSnap.data().name : "이용자";
      } catch {
        nameByUid[uid] = "이용자";
      }
    })
  );

  const ranked = uids
    .map((uid) => ({ uid, count: countByUid[uid], name: nameByUid[uid] || "이용자" }))
    .sort((a, b) => b.count - a.count);

  list.innerHTML = "";
  if (ranked.length === 0) {
    list.innerHTML = '<p class="hint">등록된 문제가 아직 없습니다.</p>';
  } else {
    ranked.forEach((r, i) => {
      const tier = getTier(r.count);
      const row = document.createElement("div");
      row.className = "rank-row";
      row.innerHTML = `
        <div class="rank-no">${i + 1}</div>
        <div class="rank-name">${escapeHtml(r.name)}${r.uid === currentUser?.uid ? " (나)" : ""}</div>
        <div class="rank-count">문제 ${r.count}개</div>
        <span class="tier-badge ${tier.cls}">${tier.name}</span>
      `;
      list.appendChild(row);
    });
  }

  if (currentUser) {
    const myCount = countByUid[currentUser.uid] || 0;
    const myTier = getTier(myCount);
    myTierBox.innerHTML = `내가 등록한 문제 <b>${myCount}개</b> · 현재 등급 <span class="tier-badge ${myTier.cls}">${myTier.name}</span>`;
  }
}
