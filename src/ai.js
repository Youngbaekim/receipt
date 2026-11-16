// 회의록 초안 작성 — Firebase AI Logic(Gemini Developer API)을 YB-Receipt의 Firebase 프로젝트로 호출
// 사용 전 Firebase 콘솔 → AI Logic 에서 "Gemini Developer API" 사용 설정이 필요합니다.
import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';
import { app } from './firebase.js';

// 앞에서부터 차례로 시도 (프로젝트에서 쓸 수 없는 모델이면 다음 것으로)
const MODELS = ['gemini-3.6-flash', 'gemini-2.5-flash'];
let ai = null;

const missingModel = (e) => /not found|404|not supported|is not available/i.test(String(e?.message || e));

/** 회의 정보와 논의 요지로 <안건 및 회의결과> 지시문 만들기 — 참석자 이름은 보내지 않고 부서명만 보냄 */
export function minutesPrompt({ topic, depts, gist }) {
  const one = depts.length < 2;
  return [
    '대학혁신지원사업 회의비 지출결의서에 첨부하는 회의록의 <안건 및 회의결과> 본문을 작성하십시오.',
    '',
    '[회의 정보]',
    `주제: ${topic}`,
    `참석 부서: ${depts.join(', ') || '(미기재)'}`,
    '',
    '[실제 논의 요지 - 작성 근거는 이것뿐임]',
    gist,
    '',
    '[작성 규칙]',
    '1. 구성은 아래 3개 대목으로 고정하고 대목 사이에 빈 줄 1줄을 둠.',
    "   '1. 주요 논의 내용' : ' * 소주제' 2~3개, 소주제마다 '   - 세부 내용' 2~3줄",
    `   '2. 부서별 역할 분담' : ' * 부서명: 역할' 형식으로 참석 부서마다 1줄, 필요하면 ' * 공통: ' 1줄${one ? " (참석 부서가 하나이면 제목을 '2. 담당별 역할 분담'으로 함)" : ''}`,
    "   '3. 향후 일정 및 후속 조치' : ' * 항목: 내용' 2~3줄",
    '2. 분량은 빈 줄을 뺀 18~22줄, 한 줄은 45자 이내.',
    '3. 문체는 개조식 명사형 종결(점검, 정비, 마련, 공유 예정 등)이며 마침표를 쓰지 않음.',
    '4. 논의 요지에 적힌 내용만 풀어 씀. 요지를 현황, 쟁점, 개선 방향으로 구체화하는 것은 되지만 요지에 없는 수치, 날짜, 금액, 인명, 기관명, 확정된 결정사항은 쓰지 않음.',
    "5. 역할 분담이나 후속 조치가 요지에 없으면 요지에서 자연히 도출되는 범위로만 쓰고 그 줄 끝에 ' [확인 필요]'를 붙임.",
    "6. 들여쓰기는 예시와 같이 ' * '는 공백 1칸, '   - '는 공백 3칸으로 시작함.",
    '7. 본문만 출력함. 머리말, 설명, 굵은 글씨 표시(**), 코드블록 표시는 쓰지 않음.',
    '',
    '[형식 예시]',
    '1. 주요 논의 내용',
    ' * 성과관리 및 지표 정비',
    '   - 부서별로 분산된 운영 실적의 관리 기준 일원화',
    '   - 지표 보완: 참여 인원 외 만족도, 학습성과 등 다각적 평가 지표 도입',
    '',
    '2. 부서별 역할 분담',
    ' * 성과관리팀: 성과자료 제출 기준 및 표준 양식 마련',
    '',
    '3. 향후 일정 및 후속 조치',
    ' * 회의 결과 공유: 과제별 담당 부서, 일정, 제출 항목 정리 후 관련 부서 배포',
  ].join('\n');
}

const clean = (t) => t.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '').replace(/\*\*/g, '').replace(/\s+$/, '');

/** @returns {Promise<string>} 본문 초안 */
export async function draftMinutes(info) {
  ai ||= getAI(app, { backend: new GoogleAIBackend() });
  const prompt = minutesPrompt(info);
  let last = null;
  for (const name of MODELS) {
    try {
      const model = getGenerativeModel(ai, { model: name, generationConfig: { temperature: 0.4 } });
      const res = await model.generateContent(prompt);
      const text = clean(res.response.text());
      if (!text) throw new Error('빈 응답');
      return text;
    } catch (e) {
      last = e;
      if (!missingModel(e)) break;
    }
  }
  throw last;
}
