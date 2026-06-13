Island Pulse frontend fix

This build fixes category and marker color consistency.

Changes:
- Category filter order: 全部事件｜交通｜災害｜意外｜活動｜其他
- Added canonical frontend category grouping:
  traffic / disaster / accident / activity / other
- Traffic control / congestion / construction now stays blue as 交通.
- Car crash / casualty / fire / public-safety incidents now group as orange 意外.
- Earthquake / typhoon / weather / flood / landslide events now group as red 災害.
- Activity / exhibition / market / sports events now group as green 活動.
- Marker pins, event badges, cards, popups, and statistics now use the same category mapping.
- Previous stable marker anchor fix is kept.

Deploy notes:
- Upload the root files in this folder to GitHub / Vercel.
- Do not upload an older index.html over this one, or the live site will keep using the old BETA/category logic.
