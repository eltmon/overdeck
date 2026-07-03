# Backlog Sequence

_Last sequenced: 2026-07-03T10:53:55.565Z · model: claude-opus-4-8 · open: 594_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 1 | PAN-2261 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 2 | PAN-2260 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 3 | PAN-2172 | M | critical | ok |  | PAN-2170 | Prevents inert agents that look healthy but do no work. |
| 4 | PAN-2157 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 5 | PAN-1456 | L | critical | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 6 | PAN-806 | L | critical | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 7 | PAN-2194 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 8 | PAN-2158 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 9 | PAN-1861 | M | critical | ok |  |  | Stops resumed conversations from silently losing transcript writes. |
| 10 | PAN-1783 | M | critical | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 11 | PAN-1560 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 12 | PAN-2270 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 13 | PAN-2186 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 14 | PAN-2179 | M | critical | ok |  |  | Prevents inert agents that look healthy but do no work. |
| 15 | PAN-2169 | M | critical | ok |  |  | Prevents inert agents that look healthy but do no work. |
| 16 | PAN-2285 | M | critical | ok |  |  | Per-agent codex auth.json rots, wedging agents in a silent 401 token_revoked loop; substrate liveness fix. |
| 17 | PAN-2108 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 18 | PAN-1698 | M | critical | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 19 | PAN-1491 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 20 | PAN-1214 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 21 | PAN-1213 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 22 | PAN-1830 | M | critical | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 23 | PAN-2228 | M | critical | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 23 | PAN-2168 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 24 | PAN-2148 | XL | critical | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 26 | PAN-2259 | M | critical | ok |  |  | GitHub quota failures block close, edit, and orchestration paths. |
| 26 | PAN-2154 | L | critical | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 28 | PAN-2165 | M | critical | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 29 | PAN-807 | L | critical | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 29 | PAN-2192 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 31 | PAN-1520 | L | critical | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 32 | PAN-1497 | M | critical | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 33 | PAN-1650 | L | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 34 | PAN-1557 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 35 | PAN-1452 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 36 | PAN-804 | L | critical | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 36 | PAN-2153 | L | high | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 38 | PAN-1113 | M | high | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 39 | PAN-2178 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 40 | PAN-2170 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 41 | PAN-2167 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 42 | PAN-2106 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 43 | PAN-1770 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 44 | PAN-1766 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 45 | PAN-1681 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 46 | PAN-1498 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 47 | PAN-1416 | M | high | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 48 | PAN-955 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 48 | PAN-2257 | M | high | ok |  |  | Prevents inert agents that look healthy but do no work. |
| 49 | PAN-2283 | M | high | ok |  |  | Wires the merged tiered-execution library so operators can actually enable difficulty-routed dispatch (off by default). |
| 51 | PAN-2075 | XL | high | ok | ✓ |  | Container; ranks by child impact, not directly pickable. |
| 52 | PAN-2284 | S | high | ok |  |  | Boot Resume-All shows phantom candidates and reports 0 resumed; filter to truly resumable agents + skip breakdown. |
| 53 | PAN-2233 | L | high | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 54 | PAN-2232 | L | high | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 55 | PAN-2229 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 56 | PAN-2190 | L | high | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 57 | PAN-2149 | L | high | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 58 | PAN-2147 | XL | high | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 59 | PAN-2265 | M | high | ok |  |  | GitHub quota failures block close, edit, and orchestration paths. |
| 60 | PAN-2006 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 61 | PAN-1499 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 62 | PAN-933 | M | high | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 63 | PAN-334 | M | high | ok |  |  | Prevents inert agents that look healthy but do no work. |
| 63 | PAN-2254 | M | high | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 64 | PAN-321 | M | high | ok |  |  | Prevents inert agents that look healthy but do no work. |
| 65 | PAN-2080 | M | high | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 67 | PAN-1705 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 68 | PAN-1207 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 69 | PAN-1198 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 70 | PAN-2145 | XL | high | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 71 | PAN-1767 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 72 | PAN-2189 | L | high | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 73 | PAN-1828 | M | high | ok |  |  | Prevents inert agents that look healthy but do no work. |
| 74 | PAN-1434 | M | high | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 75 | PAN-2193 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 76 | PAN-2095 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 76 | PAN-2255 | M | high | ok |  | PAN-2228 | Routine backlog item; rank reflects current shipping leverage. |
| 77 | PAN-1618 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 78 | PAN-1209 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 80 | PAN-1730 | M | high | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 81 | PAN-2188 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 82 | PAN-2187 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 83 | PAN-1588 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 84 | PAN-1246 | M | high | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 85 | PAN-1219 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 85 | PAN-1917 | L | high | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 86 | PAN-1217 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 87 | PAN-813 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 89 | PAN-2202 | L | high | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 90 | PAN-1570 | L | high | ok |  |  | Prevents inert agents that look healthy but do no work. |
| 91 | PAN-1444 | M | high | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 92 | PAN-1440 | M | high | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 93 | PAN-1436 | M | high | needs-refinement |  |  | Prevents inert agents that look healthy but do no work. |
| 94 | PAN-262 | M | high | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 95 | PAN-2240 | M | high | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 96 | PAN-2207 | M | high | ok |  |  | GitHub quota failures block close, edit, and orchestration paths. |
| 97 | PAN-1912 | M | high | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 98 | PAN-1556 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 99 | PAN-1433 | M | high | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 100 | PAN-1330 | M | high | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 100 | PAN-2227 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 101 | PAN-675 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 102 | PAN-629 | M | high | ok |  |  | GitHub quota failures block close, edit, and orchestration paths. |
| 104 | PAN-2231 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 105 | PAN-2230 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 106 | PAN-1454 | L | high | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 107 | PAN-2059 | XL | high | ok | ✓ |  | Container; ranks by child impact, not directly pickable. |
| 108 | PAN-1889 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 109 | PAN-1594 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 110 | PAN-1578 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 111 | PAN-1558 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 112 | PAN-1254 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 112 | PAN-2156 | L | high | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 113 | PAN-1253 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 114 | PAN-630 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 116 | PAN-2079 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 117 | PAN-2078 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 118 | PAN-2077 | L | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 119 | PAN-1451 | L | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 120 | PAN-1218 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 121 | PAN-1561 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 121 | PAN-2081 | L | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 122 | PAN-1538 | M | high | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 122 | PAN-2151 | L | high | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 123 | PAN-1357 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 126 | PAN-1915 | M | high | ok |  |  | Closes security exposure in local/operator configuration. |
| 127 | PAN-2027 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 128 | PAN-1913 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 129 | PAN-1544 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 130 | PAN-1525 | L | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 131 | PAN-1504 | M | high | needs-refinement |  |  | Hardens the pipeline paths that ship all other work. |
| 132 | PAN-1196 | M | high | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 133 | PAN-1142 | M | high | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 134 | PAN-1435 | M | high | ok |  |  | Closes security exposure in local/operator configuration. |
| 135 | PAN-578 | M | high | needs-refinement |  |  | Closes security exposure in local/operator configuration. |
| 136 | PAN-1424 | M | high | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 137 | PAN-1313 | L | high | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 138 | PAN-1311 | M | high | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 139 | PAN-2253 | M | medium | ok |  | PAN-2252 | Prevents inert agents that look healthy but do no work. |
| 140 | PAN-2252 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 141 | PAN-1755 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 142 | PAN-1691 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 143 | PAN-1627 | M | medium | ok |  |  | Stops resumed conversations from silently losing transcript writes. |
| 144 | PAN-1572 | M | medium | ok |  |  | Prevents inert agents that look healthy but do no work. |
| 145 | PAN-1437 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 146 | PAN-1245 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 147 | PAN-1208 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 148 | PAN-1154 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 149 | PAN-780 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 150 | PAN-687 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 151 | PAN-1824 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 152 | PAN-2280 | M | medium | ok |  | PAN-2252 | Stops resumed conversations from silently losing transcript writes. |
| 153 | PAN-2163 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 154 | PAN-1937 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 155 | PAN-1897 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 156 | PAN-1816 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 157 | PAN-1674 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 158 | PAN-1672 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 159 | PAN-1564 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 160 | PAN-1490 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 161 | PAN-1446 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 162 | PAN-1438 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 163 | PAN-1392 | L | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 164 | PAN-1386 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 165 | PAN-1247 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 166 | PAN-1243 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 167 | PAN-1173 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 168 | PAN-1131 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 169 | PAN-1130 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 170 | PAN-1129 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 171 | PAN-1027 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 172 | PAN-929 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 173 | PAN-928 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 174 | PAN-899 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 175 | PAN-890 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 176 | PAN-886 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 177 | PAN-681 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 178 | PAN-658 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 179 | PAN-605 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 180 | PAN-324 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 181 | PAN-1122 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 182 | PAN-1565 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 183 | PAN-1461 | M | medium | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 184 | PAN-1128 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 185 | PAN-1038 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 186 | PAN-900 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 186 | PAN-1718 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 187 | PAN-764 | M | medium | ok |  |  | GitHub quota failures block close, edit, and orchestration paths. |
| 188 | PAN-673 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 189 | PAN-2181 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 190 | PAN-1234 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 190 | PAN-2086 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 191 | PAN-1232 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 194 | PAN-1837 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 195 | PAN-1708 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 196 | PAN-1670 | M | medium | ok |  |  | Stops resumed conversations from silently losing transcript writes. |
| 197 | PAN-1643 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 198 | PAN-1641 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 199 | PAN-1553 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 200 | PAN-1482 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 201 | PAN-771 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 202 | PAN-752 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 203 | PAN-702 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 204 | PAN-466 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 205 | PAN-463 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 206 | PAN-2085 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 207 | PAN-1986 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 208 | PAN-1958 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 209 | PAN-1761 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 210 | PAN-1655 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 211 | PAN-1356 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 212 | PAN-777 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 213 | PAN-576 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 214 | PAN-468 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 215 | PAN-452 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 216 | PAN-2069 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 217 | PAN-2005 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 218 | PAN-1951 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 219 | PAN-1862 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 220 | PAN-1852 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 221 | PAN-1775 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 222 | PAN-1706 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 223 | PAN-1696 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 224 | PAN-1610 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 225 | PAN-1102 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 226 | PAN-783 | L | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 227 | PAN-1983 | L | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 228 | PAN-2245 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 229 | PAN-2244 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 230 | PAN-2243 | L | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 231 | PAN-2242 | L | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 232 | PAN-2241 | L | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 233 | PAN-2237 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 234 | PAN-1795 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 235 | PAN-1673 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 236 | PAN-1624 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 237 | PAN-1582 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 238 | PAN-1530 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 239 | PAN-1449 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 240 | PAN-1445 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 241 | PAN-1240 | L | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 242 | PAN-1150 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 243 | PAN-1149 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 244 | PAN-1068 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 245 | PAN-1042 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 246 | PAN-932 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 247 | PAN-304 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 248 | PAN-1896 | M | medium | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 249 | PAN-1577 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 250 | PAN-1533 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 251 | PAN-2251 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 252 | PAN-2212 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 253 | PAN-2211 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 254 | PAN-2210 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 255 | PAN-2209 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 256 | PAN-2198 | L | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 257 | PAN-2197 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 258 | PAN-2053 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 259 | PAN-2032 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 260 | PAN-2004 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 261 | PAN-1995 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 262 | PAN-1990 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 263 | PAN-1988 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 264 | PAN-1985 | L | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 265 | PAN-1980 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 266 | PAN-1967 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 267 | PAN-1966 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 268 | PAN-1965 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 269 | PAN-1963 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 270 | PAN-1914 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 271 | PAN-1895 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 272 | PAN-1874 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 273 | PAN-1846 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 274 | PAN-1844 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 275 | PAN-1840 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 276 | PAN-1774 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 277 | PAN-1773 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 278 | PAN-1758 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 279 | PAN-1751 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 280 | PAN-1750 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 281 | PAN-1748 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 282 | PAN-1740 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 283 | PAN-1739 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 284 | PAN-1735 | L | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 285 | PAN-1734 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 286 | PAN-1728 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 287 | PAN-1726 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 288 | PAN-1720 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 289 | PAN-1676 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 290 | PAN-1668 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 291 | PAN-1667 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 292 | PAN-1666 | XL | medium | ok | ✓ |  | Container; ranks by child impact, not directly pickable. |
| 293 | PAN-1657 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 294 | PAN-1656 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 295 | PAN-1622 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 296 | PAN-1620 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 297 | PAN-1619 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 298 | PAN-1581 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 299 | PAN-1542 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 300 | PAN-1453 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 301 | PAN-1432 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 302 | PAN-1244 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 303 | PAN-1165 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 304 | PAN-1147 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 305 | PAN-1136 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 306 | PAN-1133 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 307 | PAN-1126 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 308 | PAN-1124 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 309 | PAN-1121 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 310 | PAN-1115 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 311 | PAN-1066 | L | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 312 | PAN-1037 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 313 | PAN-943 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 314 | PAN-938 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 315 | PAN-908 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 316 | PAN-835 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 317 | PAN-833 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 318 | PAN-832 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 319 | PAN-778 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 320 | PAN-775 | L | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 321 | PAN-769 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 322 | PAN-736 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 323 | PAN-735 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 324 | PAN-727 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 325 | PAN-709 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 326 | PAN-678 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 327 | PAN-624 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 328 | PAN-622 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 329 | PAN-613 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 330 | PAN-606 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 331 | PAN-604 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 332 | PAN-603 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 333 | PAN-568 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 334 | PAN-538 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 335 | PAN-483 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 336 | PAN-480 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 337 | PAN-476 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 338 | PAN-471 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 339 | PAN-456 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 340 | PAN-371 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 341 | PAN-306 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 342 | PAN-637 | M | medium | ok |  |  | Prevents inert agents that look healthy but do no work. |
| 343 | PAN-531 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 344 | PAN-38 | M | medium | stale |  |  | Prevents workspace servers from impersonating production dashboard. |
| 345 | PAN-37 | M | medium | stale |  |  | Prevents workspace servers from impersonating production dashboard. |
| 345 | PAN-2224 | L | medium | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 346 | PAN-1868 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 347 | PAN-1488 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 349 | PAN-2282 | M | medium | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 350 | PAN-2084 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 351 | PAN-2046 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 352 | PAN-2034 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 353 | PAN-2024 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 354 | PAN-1854 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 355 | PAN-1853 | M | medium | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 356 | PAN-1646 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 357 | PAN-1644 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 358 | PAN-1623 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 359 | PAN-1621 | M | medium | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 360 | PAN-1571 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 361 | PAN-1552 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 362 | PAN-1545 | M | medium | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 363 | PAN-1485 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 364 | PAN-1473 | M | medium | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 365 | PAN-1123 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 366 | PAN-949 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 367 | PAN-818 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 368 | PAN-772 | M | medium | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 369 | PAN-747 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 370 | PAN-738 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 371 | PAN-649 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 372 | PAN-565 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 373 | PAN-1776 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 374 | PAN-1685 | L | medium | needs-refinement |  |  | Prevents workspace servers from impersonating production dashboard. |
| 375 | PAN-1547 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 376 | PAN-1439 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 377 | PAN-1164 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 378 | PAN-1101 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 379 | PAN-947 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 380 | PAN-608 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 380 | PAN-2208 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 381 | PAN-247 | M | medium | stale |  |  | Hardens the pipeline paths that ship all other work. |
| 382 | PAN-113 | M | medium | stale |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 384 | PAN-2070 | M | low | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 385 | PAN-2068 | M | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 386 | PAN-1769 | M | low | needs-refinement |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 387 | PAN-1711 | M | low | needs-refinement |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 388 | PAN-1683 | M | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 389 | PAN-1469 | M | low | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 390 | PAN-1227 | M | low | needs-refinement |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 391 | PAN-1226 | L | low | needs-refinement |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 392 | PAN-633 | M | low | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 393 | PAN-487 | L | low | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 394 | PAN-1654 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 395 | PAN-853 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 396 | PAN-810 | M | low | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 397 | PAN-793 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 398 | PAN-774 | M | low | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 399 | PAN-663 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 400 | PAN-589 | M | low | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 401 | PAN-454 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 402 | PAN-407 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 403 | PAN-2266 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 404 | PAN-2213 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 405 | PAN-2201 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 406 | PAN-2195 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 407 | PAN-2091 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 408 | PAN-2083 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 409 | PAN-2082 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 410 | PAN-2065 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 411 | PAN-2045 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 412 | PAN-2035 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 413 | PAN-2033 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 414 | PAN-2031 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 415 | PAN-2030 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 416 | PAN-2029 | L | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 417 | PAN-2028 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 418 | PAN-2026 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 419 | PAN-2025 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 420 | PAN-1999 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 421 | PAN-1991 | L | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 422 | PAN-1987 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 423 | PAN-1968 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 424 | PAN-1955 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 425 | PAN-1954 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 426 | PAN-1953 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 427 | PAN-1949 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 428 | PAN-1936 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 429 | PAN-1926 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 430 | PAN-1916 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 431 | PAN-1910 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 432 | PAN-1907 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 433 | PAN-1906 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 434 | PAN-1839 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 435 | PAN-1782 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 436 | PAN-1754 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 437 | PAN-1729 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 438 | PAN-1710 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 439 | PAN-1671 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 440 | PAN-1669 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 441 | PAN-1640 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 442 | PAN-1592 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 443 | PAN-1573 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 444 | PAN-1550 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 445 | PAN-1548 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 446 | PAN-1524 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 447 | PAN-1493 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 448 | PAN-1489 | M | low | needs-refinement |  |  | Hardens the pipeline paths that ship all other work. |
| 449 | PAN-1481 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 450 | PAN-1480 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 451 | PAN-1479 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 452 | PAN-1474 | S | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 453 | PAN-1442 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 454 | PAN-1325 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 455 | PAN-1242 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 456 | PAN-1238 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 457 | PAN-1222 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 458 | PAN-1166 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 459 | PAN-1153 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 460 | PAN-1116 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 461 | PAN-1065 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 462 | PAN-1064 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 463 | PAN-1063 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 464 | PAN-1060 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 465 | PAN-1049 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 466 | PAN-1041 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 467 | PAN-962 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 468 | PAN-958 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 469 | PAN-948 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 470 | PAN-944 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 471 | PAN-927 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 472 | PAN-904 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 473 | PAN-903 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 474 | PAN-902 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 475 | PAN-863 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 476 | PAN-838 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 477 | PAN-790 | L | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 478 | PAN-786 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 479 | PAN-773 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 480 | PAN-765 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 481 | PAN-762 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 482 | PAN-751 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 483 | PAN-750 | L | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 484 | PAN-749 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 485 | PAN-730 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 486 | PAN-683 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 487 | PAN-660 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 488 | PAN-623 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 489 | PAN-607 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 490 | PAN-592 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 491 | PAN-570 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 492 | PAN-564 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 493 | PAN-554 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 494 | PAN-552 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 495 | PAN-548 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 496 | PAN-546 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 497 | PAN-543 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 498 | PAN-537 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 499 | PAN-532 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 500 | PAN-465 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 501 | PAN-461 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 502 | PAN-459 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 503 | PAN-450 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 504 | PAN-438 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 505 | PAN-399 | M | low | needs-refinement |  |  | Hardens the pipeline paths that ship all other work. |
| 506 | PAN-198 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 507 | PAN-1838 | M | low | needs-refinement |  |  | Prevents workspace servers from impersonating production dashboard. |
| 508 | PAN-111 | M | low | stale |  |  | Prevents workspace servers from impersonating production dashboard. |
| 509 | PAN-743 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 510 | PAN-701 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 511 | PAN-175 | M | low | stale |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 512 | PAN-2008 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 513 | PAN-1984 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 514 | PAN-49 | M | low | stale |  |  | Hardens the pipeline paths that ship all other work. |
| 515 | PAN-1103 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 516 | PAN-826 | M | low | needs-refinement |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 517 | PAN-802 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 518 | PAN-700 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 519 | PAN-1653 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 520 | PAN-1494 | M | low | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 521 | PAN-244 | M | low | stale |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 522 | PAN-2073 | M | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 523 | PAN-2072 | M | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 524 | PAN-2071 | M | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 525 | PAN-2067 | M | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 526 | PAN-1878 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 527 | PAN-1443 | L | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 528 | PAN-1135 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 529 | PAN-1117 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 530 | PAN-961 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 531 | PAN-634 | M | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 532 | PAN-2037 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 533 | PAN-2002 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 534 | PAN-1918 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 535 | PAN-1483 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 536 | PAN-1152 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 537 | PAN-1151 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 538 | PAN-1051 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 539 | PAN-1040 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 540 | PAN-984 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 541 | PAN-901 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 542 | PAN-834 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 543 | PAN-791 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 544 | PAN-654 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 545 | PAN-591 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 546 | PAN-571 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 547 | PAN-298 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 548 | PAN-297 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 549 | PAN-293 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 550 | PAN-283 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 551 | PAN-265 | M | low | stale |  |  | Hardens the pipeline paths that ship all other work. |
| 552 | PAN-255 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 553 | PAN-252 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 554 | PAN-190 | M | low | stale |  |  | Hardens the pipeline paths that ship all other work. |
| 555 | PAN-180 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 556 | PAN-177 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 557 | PAN-176 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 558 | PAN-47 | L | low | stale |  |  | Hardens the pipeline paths that ship all other work. |
| 559 | PAN-43 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 560 | PAN-2066 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 561 | PAN-1223 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 562 | PAN-898 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 563 | PAN-817 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 563 | PAN-1894 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 564 | PAN-797 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 565 | PAN-713 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 567 | PAN-245 | M | low | stale |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 568 | PAN-1684 | M | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 569 | PAN-674 | M | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 570 | PAN-656 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 571 | PAN-2074 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 572 | PAN-924 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 573 | PAN-646 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 574 | PAN-299 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 575 | PAN-294 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 576 | PAN-277 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 577 | PAN-271 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 578 | PAN-258 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 579 | PAN-243 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 580 | PAN-228 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 581 | PAN-227 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 582 | PAN-178 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 583 | PAN-155 | L | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 584 | PAN-146 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 585 | PAN-106 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 586 | PAN-104 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 587 | PAN-77 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 588 | PAN-55 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 589 | PAN-54 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 590 | PAN-44 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 591 | PAN-51 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 592 | PAN-249 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 593 | PAN-241 | L | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 594 | PAN-52 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |

## Rationale detail

### PAN-2261 (rank 1)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2260 (rank 2)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2172 (rank 3)

The body is merged/verifying, but the host-mode kickoff failure class remains high impact while open.

### PAN-2157 (rank 4)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1456 (rank 5)

High score reflects direct risk to pipeline progress, operator recovery, or autonomous shipping paths.

### PAN-806 (rank 6)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2194 (rank 7)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2158 (rank 8)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1861 (rank 9)

High score reflects direct risk to pipeline progress, operator recovery, or autonomous shipping paths.

### PAN-1783 (rank 10)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1560 (rank 11)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2270 (rank 12)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2186 (rank 13)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2179 (rank 14)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2169 (rank 15)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2285 (rank 16)

A stale seed-once copy of ~/.codex/auth.json forks the OAuth refresh chain, so respawned codex agents wedge permanently in a 401 retry loop while looking healthy on every surface — the same liveness-illusion class as PAN-2172. A staleness re-seed at spawn plus a troubled-gate trip on repeated token_revoked restores reliable codex dispatch, which is a prerequisite for shipping any gpt-5.5-routed work.

### PAN-2108 (rank 17)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1698 (rank 18)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1491 (rank 19)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1214 (rank 20)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1213 (rank 21)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1830 (rank 22)

High score reflects direct risk to pipeline progress, operator recovery, or autonomous shipping paths.

### PAN-2228 (rank 23)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2168 (rank 23)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2148 (rank 24)

The body confirms this is behavior-preserving decomposition of a 4k-line server route, so it stays high substrate work.

### PAN-2259 (rank 26)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2154 (rank 26)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2165 (rank 28)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-807 (rank 29)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2192 (rank 29)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1520 (rank 31)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1497 (rank 32)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1650 (rank 33)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1557 (rank 34)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1452 (rank 35)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-804 (rank 36)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2153 (rank 36)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1113 (rank 38)

Top-tier item because it has near-term operator value and a clear path to verification.

### PAN-2178 (rank 39)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2170 (rank 40)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2167 (rank 41)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2106 (rank 42)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1770 (rank 43)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1766 (rank 44)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1681 (rank 45)

Top-tier item because it has near-term operator value and a clear path to verification.

### PAN-1498 (rank 46)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1416 (rank 47)

Top-tier item because it has near-term operator value and a clear path to verification.

### PAN-955 (rank 48)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2257 (rank 48)

The changed body clarifies troubled agents silently queue operator messages, raising its impact as a delivery-loss UI fix.

### PAN-2283 (rank 49)

PAN-1791/PAN-2222 merged the full tiered-execution library but never landed the config-load, dispatch-threading, or settings wiring, so no operator can turn it on. This ignition work makes an entire shipped subsystem reachable behind two explicit opt-in doors. In-pipeline (planning), so pinned at gate=auto.

### PAN-2075 (rank 51)

Epic container score is derived from open child issues; it is not directly pickable.

### PAN-2284 (rank 52)

Boot reconciliation lists 39 candidates but resumes 0 because it does not apply the resumability predicates the resume path enforces, so the modal reads as a broken button and buries the 1-2 genuinely resumable agents. Sharing the skip checks and returning a skip breakdown restores a trustworthy boot-recovery UX, adjacent to the PAN-2075 reconciliation epic.

### PAN-2233 (rank 53)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2232 (rank 54)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2229 (rank 55)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2190 (rank 56)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2149 (rank 57)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2147 (rank 58)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2265 (rank 59)

Top-tier item because it has near-term operator value and a clear path to verification.

### PAN-2006 (rank 60)

Top-tier item because it has near-term operator value and a clear path to verification.

### PAN-1499 (rank 61)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-933 (rank 62)

Top-tier item because it has near-term operator value and a clear path to verification.

### PAN-334 (rank 63)

Top-tier item because it has near-term operator value and a clear path to verification.

### PAN-2254 (rank 63)

Top-tier item because it has near-term operator value and a clear path to verification.

### PAN-321 (rank 64)

Top-tier item because it has near-term operator value and a clear path to verification.

### PAN-2080 (rank 65)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1705 (rank 67)

Top-tier item because it has near-term operator value and a clear path to verification.

### PAN-1207 (rank 68)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1198 (rank 69)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2145 (rank 70)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1767 (rank 71)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2189 (rank 72)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1828 (rank 73)

Top-tier item because it has near-term operator value and a clear path to verification.

### PAN-1434 (rank 74)

Top-tier item because it has near-term operator value and a clear path to verification.

### PAN-2193 (rank 75)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2095 (rank 76)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2255 (rank 76)

Top-tier item because it has near-term operator value and a clear path to verification.

### PAN-1618 (rank 77)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1209 (rank 78)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1730 (rank 80)

Top-tier item because it has near-term operator value and a clear path to verification.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-07-03T10:53:55.565Z",
  "model": "claude-opus-4-8",
  "pass": "incremental",
  "openCount": 594,
  "nodes": [
    {
      "issue": "PAN-2261",
      "rank": 1,
      "size": "M",
      "importance": "critical",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2260",
      "rank": 2,
      "size": "M",
      "importance": "critical",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2172",
      "rank": 3,
      "size": "M",
      "importance": "critical",
      "score": 99,
      "condition": "ok",
      "dependsOn": [
        "PAN-2170"
      ],
      "why": "Prevents inert agents that look healthy but do no work.",
      "rationale": "The body is merged/verifying, but the host-mode kickoff failure class remains high impact while open.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2157",
      "rank": 4,
      "size": "M",
      "importance": "critical",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1456",
      "rank": 5,
      "size": "L",
      "importance": "critical",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "rationale": "High score reflects direct risk to pipeline progress, operator recovery, or autonomous shipping paths.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-806",
      "rank": 6,
      "size": "L",
      "importance": "critical",
      "score": 99,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2194",
      "rank": 7,
      "size": "M",
      "importance": "critical",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2158",
      "rank": 8,
      "size": "M",
      "importance": "critical",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1861",
      "rank": 9,
      "size": "M",
      "importance": "critical",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stops resumed conversations from silently losing transcript writes.",
      "rationale": "High score reflects direct risk to pipeline progress, operator recovery, or autonomous shipping paths.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1783",
      "rank": 10,
      "size": "M",
      "importance": "critical",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1560",
      "rank": 11,
      "size": "M",
      "importance": "critical",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2270",
      "rank": 12,
      "size": "M",
      "importance": "critical",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2186",
      "rank": 13,
      "size": "M",
      "importance": "critical",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2179",
      "rank": 14,
      "size": "M",
      "importance": "critical",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents inert agents that look healthy but do no work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2169",
      "rank": 15,
      "size": "M",
      "importance": "critical",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents inert agents that look healthy but do no work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2285",
      "rank": 16,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-agent codex auth.json rots, wedging agents in a silent 401 token_revoked loop; substrate liveness fix.",
      "rationale": "A stale seed-once copy of ~/.codex/auth.json forks the OAuth refresh chain, so respawned codex agents wedge permanently in a 401 retry loop while looking healthy on every surface — the same liveness-illusion class as PAN-2172. A staleness re-seed at spawn plus a troubled-gate trip on repeated token_revoked restores reliable codex dispatch, which is a prerequisite for shipping any gpt-5.5-routed work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2108",
      "rank": 17,
      "size": "M",
      "importance": "critical",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1698",
      "rank": 18,
      "size": "M",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1491",
      "rank": 19,
      "size": "M",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1214",
      "rank": 20,
      "size": "M",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1213",
      "rank": 21,
      "size": "M",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1830",
      "rank": 22,
      "size": "M",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "rationale": "High score reflects direct risk to pipeline progress, operator recovery, or autonomous shipping paths.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2228",
      "rank": 23,
      "size": "M",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2168",
      "rank": 23,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2148",
      "rank": 24,
      "size": "XL",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "rationale": "The body confirms this is behavior-preserving decomposition of a 4k-line server route, so it stays high substrate work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2259",
      "rank": 26,
      "size": "M",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub quota failures block close, edit, and orchestration paths.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2154",
      "rank": 26,
      "size": "L",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2165",
      "rank": 28,
      "size": "M",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-807",
      "rank": 29,
      "size": "L",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2192",
      "rank": 29,
      "size": "M",
      "importance": "critical",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1520",
      "rank": 31,
      "size": "L",
      "importance": "critical",
      "score": 85,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1497",
      "rank": 32,
      "size": "M",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1650",
      "rank": 33,
      "size": "L",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1557",
      "rank": 34,
      "size": "M",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1452",
      "rank": 35,
      "size": "M",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-804",
      "rank": 36,
      "size": "L",
      "importance": "critical",
      "score": 66,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2153",
      "rank": 36,
      "size": "L",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1113",
      "rank": 38,
      "size": "M",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2178",
      "rank": 39,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2170",
      "rank": 40,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2167",
      "rank": 41,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2106",
      "rank": 42,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1770",
      "rank": 43,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1766",
      "rank": 44,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1681",
      "rank": 45,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1498",
      "rank": 46,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1416",
      "rank": 47,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-955",
      "rank": 48,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2283",
      "rank": 49,
      "size": "M",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Wires the merged tiered-execution library so operators can actually enable difficulty-routed dispatch (off by default).",
      "rationale": "PAN-1791/PAN-2222 merged the full tiered-execution library but never landed the config-load, dispatch-threading, or settings wiring, so no operator can turn it on. This ignition work makes an entire shipped subsystem reachable behind two explicit opt-in doors. In-pipeline (planning), so pinned at gate=auto.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2257",
      "rank": 48,
      "size": "M",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents inert agents that look healthy but do no work.",
      "rationale": "The changed body clarifies troubled agents silently queue operator messages, raising its impact as a delivery-loss UI fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2075",
      "rank": 51,
      "size": "XL",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Container; ranks by child impact, not directly pickable.",
      "rationale": "Epic container score is derived from open child issues; it is not directly pickable.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2284",
      "rank": 52,
      "size": "S",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Boot Resume-All shows phantom candidates and reports 0 resumed; filter to truly resumable agents + skip breakdown.",
      "rationale": "Boot reconciliation lists 39 candidates but resumes 0 because it does not apply the resumability predicates the resume path enforces, so the modal reads as a broken button and buries the 1-2 genuinely resumable agents. Sharing the skip checks and returning a skip breakdown restores a trustworthy boot-recovery UX, adjacent to the PAN-2075 reconciliation epic.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2233",
      "rank": 53,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2232",
      "rank": 54,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2229",
      "rank": 55,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2190",
      "rank": 56,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2149",
      "rank": 57,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2147",
      "rank": 58,
      "size": "XL",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2265",
      "rank": 59,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub quota failures block close, edit, and orchestration paths.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2006",
      "rank": 60,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1499",
      "rank": 61,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-933",
      "rank": 62,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-334",
      "rank": 63,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents inert agents that look healthy but do no work.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-321",
      "rank": 64,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents inert agents that look healthy but do no work.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2080",
      "rank": 65,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2254",
      "rank": 63,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1705",
      "rank": 67,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1207",
      "rank": 68,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1198",
      "rank": 69,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2145",
      "rank": 70,
      "size": "XL",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1767",
      "rank": 71,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2189",
      "rank": 72,
      "size": "L",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1828",
      "rank": 73,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents inert agents that look healthy but do no work.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1434",
      "rank": 74,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2193",
      "rank": 75,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2095",
      "rank": 76,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1618",
      "rank": 77,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1209",
      "rank": 78,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2255",
      "rank": 76,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [
        "PAN-2228"
      ],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1730",
      "rank": 80,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2188",
      "rank": 81,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2187",
      "rank": 82,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1588",
      "rank": 83,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1246",
      "rank": 84,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1219",
      "rank": 85,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1217",
      "rank": 86,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-813",
      "rank": 87,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1917",
      "rank": 85,
      "size": "L",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "rationale": "The body is a UX/data-page redesign with a PRD, but it remains behind the underlying multi-harness transcript pipeline.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2202",
      "rank": 89,
      "size": "L",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1570",
      "rank": 90,
      "size": "L",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents inert agents that look healthy but do no work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1444",
      "rank": 91,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1440",
      "rank": 92,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1436",
      "rank": 93,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Prevents inert agents that look healthy but do no work.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-262",
      "rank": 94,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2240",
      "rank": 95,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2207",
      "rank": 96,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub quota failures block close, edit, and orchestration paths.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1912",
      "rank": 97,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1556",
      "rank": 98,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1433",
      "rank": 99,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1330",
      "rank": 100,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-675",
      "rank": 101,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-629",
      "rank": 102,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub quota failures block close, edit, and orchestration paths.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2227",
      "rank": 100,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "The body is merged/verifying-on-main; it remains in the active set but is below unmerged blockers.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2231",
      "rank": 104,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2230",
      "rank": 105,
      "size": "M",
      "importance": "high",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1454",
      "rank": 106,
      "size": "L",
      "importance": "high",
      "score": 62,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2059",
      "rank": 107,
      "size": "XL",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Container; ranks by child impact, not directly pickable.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1889",
      "rank": 108,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1594",
      "rank": 109,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1578",
      "rank": 110,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1558",
      "rank": 111,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1254",
      "rank": 112,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1253",
      "rank": 113,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-630",
      "rank": 114,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2156",
      "rank": 112,
      "size": "L",
      "importance": "high",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2079",
      "rank": 116,
      "size": "M",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2078",
      "rank": 117,
      "size": "M",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2077",
      "rank": 118,
      "size": "L",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1451",
      "rank": 119,
      "size": "L",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1218",
      "rank": 120,
      "size": "M",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1561",
      "rank": 121,
      "size": "M",
      "importance": "high",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1538",
      "rank": 122,
      "size": "M",
      "importance": "high",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1357",
      "rank": 123,
      "size": "M",
      "importance": "high",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2081",
      "rank": 121,
      "size": "L",
      "importance": "high",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2151",
      "rank": 122,
      "size": "L",
      "importance": "high",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1915",
      "rank": 126,
      "size": "M",
      "importance": "high",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Closes security exposure in local/operator configuration.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2027",
      "rank": 127,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1913",
      "rank": 128,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1544",
      "rank": 129,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1525",
      "rank": 130,
      "size": "L",
      "importance": "high",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1504",
      "rank": 131,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1196",
      "rank": 132,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1142",
      "rank": 133,
      "size": "M",
      "importance": "high",
      "score": 46,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1435",
      "rank": 134,
      "size": "M",
      "importance": "high",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Closes security exposure in local/operator configuration.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-578",
      "rank": 135,
      "size": "M",
      "importance": "high",
      "score": 41,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Closes security exposure in local/operator configuration.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1424",
      "rank": 136,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1313",
      "rank": 137,
      "size": "L",
      "importance": "high",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1311",
      "rank": 138,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2253",
      "rank": 139,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [
        "PAN-2252"
      ],
      "why": "Prevents inert agents that look healthy but do no work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2252",
      "rank": 140,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "rationale": "The body documents a production dashboard impersonation incident, so identity checks rank as critical substrate hardening.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1755",
      "rank": 141,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1691",
      "rank": 142,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1627",
      "rank": 143,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stops resumed conversations from silently losing transcript writes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1572",
      "rank": 144,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents inert agents that look healthy but do no work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1437",
      "rank": 145,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1245",
      "rank": 146,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1208",
      "rank": 147,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1154",
      "rank": 148,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-780",
      "rank": 149,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-687",
      "rank": 150,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1824",
      "rank": 151,
      "size": "M",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2280",
      "rank": 152,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [
        "PAN-2252"
      ],
      "why": "Stops resumed conversations from silently losing transcript writes.",
      "rationale": "The new body ties transcript loss to black-holed dashboard hooks and live wedges, making it a critical durability blocker.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2163",
      "rank": 153,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1937",
      "rank": 154,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1897",
      "rank": 155,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1816",
      "rank": 156,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1674",
      "rank": 157,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1672",
      "rank": 158,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1564",
      "rank": 159,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1490",
      "rank": 160,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1446",
      "rank": 161,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1438",
      "rank": 162,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1392",
      "rank": 163,
      "size": "L",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1386",
      "rank": 164,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1247",
      "rank": 165,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1243",
      "rank": 166,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1173",
      "rank": 167,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1131",
      "rank": 168,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1130",
      "rank": 169,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1129",
      "rank": 170,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1027",
      "rank": 171,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-929",
      "rank": 172,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-928",
      "rank": 173,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-899",
      "rank": 174,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-890",
      "rank": 175,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-886",
      "rank": 176,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-681",
      "rank": 177,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-658",
      "rank": 178,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-605",
      "rank": 179,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-324",
      "rank": 180,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1122",
      "rank": 181,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1565",
      "rank": 182,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1461",
      "rank": 183,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1128",
      "rank": 184,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1038",
      "rank": 185,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-900",
      "rank": 186,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-764",
      "rank": 187,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub quota failures block close, edit, and orchestration paths.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-673",
      "rank": 188,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1718",
      "rank": 186,
      "size": "M",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1234",
      "rank": 190,
      "size": "M",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1232",
      "rank": 191,
      "size": "M",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2181",
      "rank": 189,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2086",
      "rank": 190,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1837",
      "rank": 194,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1708",
      "rank": 195,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1670",
      "rank": 196,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stops resumed conversations from silently losing transcript writes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1643",
      "rank": 197,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1641",
      "rank": 198,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1553",
      "rank": 199,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1482",
      "rank": 200,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-771",
      "rank": 201,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-752",
      "rank": 202,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-702",
      "rank": 203,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-466",
      "rank": 204,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-463",
      "rank": 205,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2085",
      "rank": 206,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1986",
      "rank": 207,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1958",
      "rank": 208,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1761",
      "rank": 209,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1655",
      "rank": 210,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1356",
      "rank": 211,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-777",
      "rank": 212,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-576",
      "rank": 213,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-468",
      "rank": 214,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-452",
      "rank": 215,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2069",
      "rank": 216,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2005",
      "rank": 217,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1951",
      "rank": 218,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1862",
      "rank": 219,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1852",
      "rank": 220,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1775",
      "rank": 221,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1706",
      "rank": 222,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1696",
      "rank": 223,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1610",
      "rank": 224,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1102",
      "rank": 225,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-783",
      "rank": 226,
      "size": "L",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1983",
      "rank": 227,
      "size": "L",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2245",
      "rank": 228,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2244",
      "rank": 229,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2243",
      "rank": 230,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2242",
      "rank": 231,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2241",
      "rank": 232,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2237",
      "rank": 233,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1795",
      "rank": 234,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1673",
      "rank": 235,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1624",
      "rank": 236,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1582",
      "rank": 237,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1530",
      "rank": 238,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1449",
      "rank": 239,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1445",
      "rank": 240,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1240",
      "rank": 241,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1150",
      "rank": 242,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1149",
      "rank": 243,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1068",
      "rank": 244,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1042",
      "rank": 245,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-932",
      "rank": 246,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-304",
      "rank": 247,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1896",
      "rank": 248,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1577",
      "rank": 249,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1533",
      "rank": 250,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2251",
      "rank": 251,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2212",
      "rank": 252,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2211",
      "rank": 253,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2210",
      "rank": 254,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2209",
      "rank": 255,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2198",
      "rank": 256,
      "size": "L",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2197",
      "rank": 257,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2053",
      "rank": 258,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2032",
      "rank": 259,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2004",
      "rank": 260,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1995",
      "rank": 261,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1990",
      "rank": 262,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1988",
      "rank": 263,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 264,
      "size": "L",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1980",
      "rank": 265,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1967",
      "rank": 266,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1966",
      "rank": 267,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1965",
      "rank": 268,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1963",
      "rank": 269,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1914",
      "rank": 270,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1895",
      "rank": 271,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1874",
      "rank": 272,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1846",
      "rank": 273,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1844",
      "rank": 274,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1840",
      "rank": 275,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1774",
      "rank": 276,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1773",
      "rank": 277,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1758",
      "rank": 278,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1751",
      "rank": 279,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1750",
      "rank": 280,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1748",
      "rank": 281,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1740",
      "rank": 282,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1739",
      "rank": 283,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1735",
      "rank": 284,
      "size": "L",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1734",
      "rank": 285,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1728",
      "rank": 286,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1726",
      "rank": 287,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1720",
      "rank": 288,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1676",
      "rank": 289,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1668",
      "rank": 290,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1667",
      "rank": 291,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1666",
      "rank": 292,
      "size": "XL",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Container; ranks by child impact, not directly pickable.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1657",
      "rank": 293,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1656",
      "rank": 294,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1622",
      "rank": 295,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1620",
      "rank": 296,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1619",
      "rank": 297,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1581",
      "rank": 298,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1542",
      "rank": 299,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1453",
      "rank": 300,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1432",
      "rank": 301,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1244",
      "rank": 302,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1165",
      "rank": 303,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1147",
      "rank": 304,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1136",
      "rank": 305,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1133",
      "rank": 306,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1126",
      "rank": 307,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1124",
      "rank": 308,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1121",
      "rank": 309,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1115",
      "rank": 310,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1066",
      "rank": 311,
      "size": "L",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1037",
      "rank": 312,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-943",
      "rank": 313,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-938",
      "rank": 314,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-908",
      "rank": 315,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-835",
      "rank": 316,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-833",
      "rank": 317,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-832",
      "rank": 318,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-778",
      "rank": 319,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-775",
      "rank": 320,
      "size": "L",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-769",
      "rank": 321,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-736",
      "rank": 322,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-735",
      "rank": 323,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-727",
      "rank": 324,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-709",
      "rank": 325,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-678",
      "rank": 326,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-624",
      "rank": 327,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-622",
      "rank": 328,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-613",
      "rank": 329,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-606",
      "rank": 330,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-604",
      "rank": 331,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-603",
      "rank": 332,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-568",
      "rank": 333,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 334,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-483",
      "rank": 335,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-480",
      "rank": 336,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-476",
      "rank": 337,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-471",
      "rank": 338,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-456",
      "rank": 339,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-371",
      "rank": 340,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-306",
      "rank": 341,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-637",
      "rank": 342,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents inert agents that look healthy but do no work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-531",
      "rank": 343,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-38",
      "rank": 344,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "stale",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-37",
      "rank": 345,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "stale",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1868",
      "rank": 346,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1488",
      "rank": 347,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2224",
      "rank": 345,
      "size": "L",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "rationale": "The body confirms multi-harness session discovery is the data prerequisite for session UX and transcript fixes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2282",
      "rank": 349,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "rationale": "New body shows non-Claude handoff transcripts use a missing resolver surface, so it ranks with the session-visibility blockers.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2084",
      "rank": 350,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2046",
      "rank": 351,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2034",
      "rank": 352,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2024",
      "rank": 353,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1854",
      "rank": 354,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1853",
      "rank": 355,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1646",
      "rank": 356,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1644",
      "rank": 357,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1623",
      "rank": 358,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1621",
      "rank": 359,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1571",
      "rank": 360,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1552",
      "rank": 361,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1545",
      "rank": 362,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1485",
      "rank": 363,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1473",
      "rank": 364,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1123",
      "rank": 365,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-949",
      "rank": 366,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-818",
      "rank": 367,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-772",
      "rank": 368,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-747",
      "rank": 369,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-738",
      "rank": 370,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-649",
      "rank": 371,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-565",
      "rank": 372,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1776",
      "rank": 373,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1685",
      "rank": 374,
      "size": "L",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1547",
      "rank": 375,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1439",
      "rank": 376,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1164",
      "rank": 377,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1101",
      "rank": 378,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-947",
      "rank": 379,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-608",
      "rank": 380,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-247",
      "rank": 381,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "stale",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-113",
      "rank": 382,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "stale",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2208",
      "rank": 380,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2070",
      "rank": 384,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2068",
      "rank": 385,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1769",
      "rank": 386,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1711",
      "rank": 387,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1683",
      "rank": 388,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1469",
      "rank": 389,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1227",
      "rank": 390,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1226",
      "rank": 391,
      "size": "L",
      "importance": "low",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-633",
      "rank": 392,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-487",
      "rank": 393,
      "size": "L",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1654",
      "rank": 394,
      "size": "M",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-853",
      "rank": 395,
      "size": "M",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-810",
      "rank": 396,
      "size": "M",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-793",
      "rank": 397,
      "size": "M",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-774",
      "rank": 398,
      "size": "M",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-663",
      "rank": 399,
      "size": "M",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-589",
      "rank": 400,
      "size": "M",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-454",
      "rank": 401,
      "size": "M",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-407",
      "rank": 402,
      "size": "M",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2266",
      "rank": 403,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2213",
      "rank": 404,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2201",
      "rank": 405,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2195",
      "rank": 406,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2091",
      "rank": 407,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2083",
      "rank": 408,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2082",
      "rank": 409,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2065",
      "rank": 410,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2045",
      "rank": 411,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2035",
      "rank": 412,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2033",
      "rank": 413,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2031",
      "rank": 414,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2030",
      "rank": 415,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2029",
      "rank": 416,
      "size": "L",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2028",
      "rank": 417,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2026",
      "rank": 418,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2025",
      "rank": 419,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1999",
      "rank": 420,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1991",
      "rank": 421,
      "size": "L",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1987",
      "rank": 422,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1968",
      "rank": 423,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1955",
      "rank": 424,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1954",
      "rank": 425,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1953",
      "rank": 426,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1949",
      "rank": 427,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1936",
      "rank": 428,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1926",
      "rank": 429,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1916",
      "rank": 430,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1910",
      "rank": 431,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1907",
      "rank": 432,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1906",
      "rank": 433,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1839",
      "rank": 434,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1782",
      "rank": 435,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1754",
      "rank": 436,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1729",
      "rank": 437,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1710",
      "rank": 438,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1671",
      "rank": 439,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1669",
      "rank": 440,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1640",
      "rank": 441,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1592",
      "rank": 442,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1573",
      "rank": 443,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1550",
      "rank": 444,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1548",
      "rank": 445,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1524",
      "rank": 446,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1493",
      "rank": 447,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1489",
      "rank": 448,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1481",
      "rank": 449,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1480",
      "rank": 450,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1479",
      "rank": 451,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1474",
      "rank": 452,
      "size": "S",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1442",
      "rank": 453,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1325",
      "rank": 454,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1242",
      "rank": 455,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1238",
      "rank": 456,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1222",
      "rank": 457,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1166",
      "rank": 458,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1153",
      "rank": 459,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1116",
      "rank": 460,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1065",
      "rank": 461,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1064",
      "rank": 462,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1063",
      "rank": 463,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1060",
      "rank": 464,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1049",
      "rank": 465,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1041",
      "rank": 466,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-962",
      "rank": 467,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-958",
      "rank": 468,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-948",
      "rank": 469,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-944",
      "rank": 470,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-927",
      "rank": 471,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-904",
      "rank": 472,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-903",
      "rank": 473,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-902",
      "rank": 474,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-863",
      "rank": 475,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-838",
      "rank": 476,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-790",
      "rank": 477,
      "size": "L",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-786",
      "rank": 478,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-773",
      "rank": 479,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-765",
      "rank": 480,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-762",
      "rank": 481,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-751",
      "rank": 482,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-750",
      "rank": 483,
      "size": "L",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-749",
      "rank": 484,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-730",
      "rank": 485,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-683",
      "rank": 486,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-660",
      "rank": 487,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-623",
      "rank": 488,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-607",
      "rank": 489,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-592",
      "rank": 490,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-570",
      "rank": 491,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-564",
      "rank": 492,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-554",
      "rank": 493,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-552",
      "rank": 494,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-548",
      "rank": 495,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-546",
      "rank": 496,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-543",
      "rank": 497,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-537",
      "rank": 498,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-532",
      "rank": 499,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-465",
      "rank": 500,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-461",
      "rank": 501,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-459",
      "rank": 502,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-450",
      "rank": 503,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-438",
      "rank": 504,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-399",
      "rank": 505,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-198",
      "rank": 506,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1838",
      "rank": 507,
      "size": "M",
      "importance": "low",
      "score": 34,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-111",
      "rank": 508,
      "size": "M",
      "importance": "low",
      "score": 34,
      "condition": "stale",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-743",
      "rank": 509,
      "size": "M",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-701",
      "rank": 510,
      "size": "M",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-175",
      "rank": 511,
      "size": "M",
      "importance": "low",
      "score": 33,
      "condition": "stale",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2008",
      "rank": 512,
      "size": "M",
      "importance": "low",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1984",
      "rank": 513,
      "size": "M",
      "importance": "low",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-49",
      "rank": 514,
      "size": "M",
      "importance": "low",
      "score": 32,
      "condition": "stale",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1103",
      "rank": 515,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-826",
      "rank": 516,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-802",
      "rank": 517,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-700",
      "rank": 518,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1653",
      "rank": 519,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1494",
      "rank": 520,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-244",
      "rank": 521,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "stale",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2073",
      "rank": 522,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2072",
      "rank": 523,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2071",
      "rank": 524,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2067",
      "rank": 525,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1878",
      "rank": 526,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1443",
      "rank": 527,
      "size": "L",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1135",
      "rank": 528,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1117",
      "rank": 529,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-961",
      "rank": 530,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-634",
      "rank": 531,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2037",
      "rank": 532,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2002",
      "rank": 533,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1918",
      "rank": 534,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1483",
      "rank": 535,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1152",
      "rank": 536,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1151",
      "rank": 537,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1051",
      "rank": 538,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1040",
      "rank": 539,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-984",
      "rank": 540,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-901",
      "rank": 541,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-834",
      "rank": 542,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-791",
      "rank": 543,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-654",
      "rank": 544,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-591",
      "rank": 545,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-571",
      "rank": 546,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-298",
      "rank": 547,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-297",
      "rank": 548,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-293",
      "rank": 549,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-283",
      "rank": 550,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-265",
      "rank": 551,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-255",
      "rank": 552,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-252",
      "rank": 553,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-190",
      "rank": 554,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-180",
      "rank": 555,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-177",
      "rank": 556,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-176",
      "rank": 557,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-47",
      "rank": 558,
      "size": "L",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-43",
      "rank": 559,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2066",
      "rank": 560,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1223",
      "rank": 561,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-898",
      "rank": 562,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-817",
      "rank": 563,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-797",
      "rank": 564,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-713",
      "rank": 565,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1894",
      "rank": 563,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "rationale": "The body is merged/released verification work, so it stays active but below unresolved substrate risks.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-245",
      "rank": 567,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1684",
      "rank": 568,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-674",
      "rank": 569,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-656",
      "rank": 570,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2074",
      "rank": 571,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-924",
      "rank": 572,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-646",
      "rank": 573,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-299",
      "rank": 574,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-294",
      "rank": 575,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-277",
      "rank": 576,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-271",
      "rank": 577,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-258",
      "rank": 578,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-243",
      "rank": 579,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-228",
      "rank": 580,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-227",
      "rank": 581,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-178",
      "rank": 582,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-155",
      "rank": 583,
      "size": "L",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-146",
      "rank": 584,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-106",
      "rank": 585,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-104",
      "rank": 586,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-77",
      "rank": 587,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-55",
      "rank": 588,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-54",
      "rank": 589,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-44",
      "rank": 590,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-51",
      "rank": 591,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-249",
      "rank": 592,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-241",
      "rank": 593,
      "size": "L",
      "importance": "low",
      "score": 9,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-52",
      "rank": 594,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    }
  ],
  "edges": [
    {
      "from": "PAN-2075",
      "to": "PAN-2077",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-2078",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-2079",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2075",
      "to": "PAN-2080",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2169",
      "to": "PAN-2172",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2170",
      "to": "PAN-2172",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2170",
      "to": "PAN-2172",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.63
    },
    {
      "from": "PAN-2172",
      "to": "PAN-2086",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2179",
      "to": "PAN-2172",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.69
    },
    {
      "from": "PAN-2224",
      "to": "PAN-1917",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2224",
      "to": "PAN-2282",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.71
    },
    {
      "from": "PAN-2228",
      "to": "PAN-2255",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.72
    },
    {
      "from": "PAN-2251",
      "to": "PAN-2252",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2252",
      "to": "PAN-2251",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2252",
      "to": "PAN-2253",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.77
    },
    {
      "from": "PAN-2252",
      "to": "PAN-2280",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2257",
      "to": "PAN-2255",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2259",
      "to": "PAN-2265",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.84
    },
    {
      "from": "PAN-2280",
      "to": "PAN-2251",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2280",
      "to": "PAN-2253",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2280",
      "to": "PAN-2282",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2282",
      "to": "PAN-2280",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2285",
      "to": "PAN-2172",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2285",
      "to": "PAN-2228",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2284",
      "to": "PAN-2075",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2284",
      "to": "PAN-2181",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2284",
      "to": "PAN-1846",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    }
  ]
}
```
