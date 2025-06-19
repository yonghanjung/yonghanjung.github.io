document.addEventListener('DOMContentLoaded', function() {
  // 필요한 HTML 요소들을 미리 찾아둡니다.
  const showAllBtn = document.getElementById('show-all-btn');
  const filterStatusEl = document.getElementById('filter-status');
  const publicationItems = document.querySelectorAll('.publication-item');
  const keywordBadges = document.querySelectorAll('.keyword-badge');

  // 필터링 함수
  function filterByKeyword(keyword) {
    let count = 0;
    publicationItems.forEach(item => {
      const itemKeywords = item.getAttribute('data-keywords');
      if (itemKeywords && itemKeywords.includes(keyword)) {
        item.style.display = 'block';
        count++;
      } else {
        item.style.display = 'none';
      }
    });
    updateFilterStatus(keyword, count);
    if (showAllBtn) {
      showAllBtn.style.display = 'inline-block';
    }
  }

  // 모든 논문을 보여주는 함수
  function showAll() {
    publicationItems.forEach(item => {
      item.style.display = 'block';
    });
    if (filterStatusEl) {
      filterStatusEl.innerHTML = '';
    }
    if (showAllBtn) {
      showAllBtn.style.display = 'none';
    }
  }

  function updateFilterStatus(keyword, count) {
    if (filterStatusEl) {
      filterStatusEl.innerHTML = `Filtering by: <strong><span class="math-inline">\{keyword\.toUpperCase\(\)\}</strong\> \(</span>{count} items found)`;
    }
  }

  // 모든 키워드 뱃지에 클릭 이벤트 추가
  keywordBadges.forEach(badge => {
    badge.style.cursor = 'pointer';
    badge.addEventListener('click', function() {
      const keyword = this.innerText.trim().toLowerCase();
      filterByKeyword(keyword);
    });
  });

  // "Show All" 버튼에 클릭 이벤트 추가
  if (showAllBtn) {
    showAllBtn.addEventListener('click', showAll);
  }

});