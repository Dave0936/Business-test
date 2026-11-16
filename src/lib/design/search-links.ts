/** Direct search links for manual research when an API is unavailable. Opening them is a human action. */
export function designSearchLinks(industryLabel: string, positioning?: string): { source: string; label: string; url: string }[] {
  const q = `${positioning ? `${positioning} ` : ""}${industryLabel} website design`;
  const e = encodeURIComponent;
  return [
    { source: "pinterest", label: "Pinterest", url: `https://www.pinterest.com/search/pins/?q=${e(q)}` },
    { source: "gallery", label: "Dribbble", url: `https://dribbble.com/search/${e(`${industryLabel} website`)}` },
    { source: "gallery", label: "Behance", url: `https://www.behance.net/search/projects?search=${e(`${industryLabel} website`)}` },
    { source: "gallery", label: "Awwwards", url: `https://www.awwwards.com/websites/?text=${e(industryLabel)}` },
    { source: "gallery", label: "Land-book", url: `https://land-book.com/?search=${e(industryLabel)}` },
    { source: "gallery", label: "SiteInspire", url: `https://www.siteinspire.com/websites?search=${e(industryLabel)}` },
  ];
}
