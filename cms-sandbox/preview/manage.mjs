import { cmsRoot } from './preview-model.mjs';
const $ = id => document.getElementById(id);
// Useful links remain available even when the repository connection is unavailable.
$('edit').href = `${cmsRoot}/collection/concerts`;
$('add').href = `${cmsRoot}/collection/concert_drafts/new`;
$('upload').href = `${cmsRoot}/file/upload_guide`;
async function refresh() {
  $('reload').disabled = true; $('error').hidden = true;
  $('summary').textContent = '저장된 내용을 확인하고 있습니다.';
  $('next-step').textContent = '잠시만 기다려 주세요.';
  try {
    const response = await fetch('/api/manage/status', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('저장된 공연 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.');
    const status = await response.json();
    if (status.app !== 'eeams-cms-manager' || status.schema !== 1 || !Number.isSafeInteger(status.concerts) || !Number.isSafeInteger(status.changes)) throw new Error('관리 화면 연결을 확인해 주세요.');
    $('summary').textContent = `저장된 공연 ${status.concerts}건 · 공개 전 변경 ${status.changes}건`;
    $('next-step').textContent = status.changes ? '공연 미리보기에서 확인한 뒤 변경 내용 확인으로 진행하세요.' : '공연의 미반영 변경이 없습니다. 다른 자료는 각 미리보기에서 확인하세요.';
    const available=status.publication?.concerts===true&&status.publication?.additionalContent===true;
    $('publication-note').textContent = available ? '최종 확인 후 게시할 수 있습니다. Save는 초안 저장이며, 사본 검증과 게시 확인을 거쳐야 공개됩니다.' : status.mode==='publication-enabled' ? '일부 자료의 게시 연결만 열려 있습니다. 각 변경 확인 화면에서 연결 상태를 확인하세요.' : '현재는 미리보기·변경 확인 모드입니다. 실제 게시 연결은 닫혀 있습니다.';
  } catch (error) {
    $('summary').textContent = '최신 저장 상태를 확인하지 못했습니다.';
    $('next-step').textContent = '연결되지 않아도 CMS 입력 화면은 열 수 있습니다.';
    $('error').textContent = error.message; $('error').hidden = false;
  } finally { $('reload').disabled = false; }
}
$('reload').addEventListener('click', refresh);
refresh();
