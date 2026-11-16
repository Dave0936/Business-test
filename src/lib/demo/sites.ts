/**
 * Fictional "current websites" for demo businesses, so the real analyser and
 * scorer can run without fetching anything. Only ever used for is_demo records
 * (reserved .example domains); results are labelled as simulated.
 */
export function demoSiteHtml(pattern: number, name: string): string {
  const n = name.replace(/^\[Demo\]\s*/, "");
  if (pattern === 1) {
    // Old table layout, no viewport, obsolete tags, plain HTTP.
    return `<html><head><title>${n}</title><meta name="generator" content="Microsoft FrontPage 4.0"><script src="js/jquery-1.4.2.min.js"></script></head>
<body bgcolor="#ffffff"><table width="960" border="0"><tr><td><table width="100%"><tr><td><font face="Arial" size="5"><b>Welcome to ${n}</b></font></td></tr></table>
<center><img src="banner.gif"><img src="photo1.jpg"></center>
<p><font size="2">Thank you for visiting our web site. Please call us for information.</font></p>
<marquee>Now open on Sundays!</marquee><p>Copyright © 2014 ${n}. All rights reserved.</p>
<a href="about.htm">About</a> <a href="menu.htm">Menu</a> <a href="links.htm">Links</a></td></tr></table></body></html>`;
  }
  if (pattern === 2) {
    // Responsive but thin: no description, no form, no booking, no CTA.
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${n}</title>
<link rel="stylesheet" href="style.css"></head><body><header><h1>${n}</h1><nav><a href="/">Home</a> <a href="/about">About</a></nav></header>
<main><img src="hero.jpg" alt="Our premises"><img src="team.jpg"><p>We have been part of the community for a long time. Visit us any time.</p></main>
<footer><p>© 2023 ${n}</p></footer></body></html>`;
  }
  // A good modern site: should score low (not a strong opportunity).
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${n} | Book online</title>
<meta name="description" content="${n}: services, prices and online booking."><link rel="stylesheet" href="app.css"><script type="application/ld+json">{"@type":"LocalBusiness"}</script></head>
<body><header><nav><a href="/">Home</a><a href="/services">Services</a><a href="/contact">Contact</a><a class="btn" href="https://www.fresha.com/book">Book now</a></nav></header>
<main><h1>${n}</h1><img src="hero.webp" alt="Inside ${n}"><a href="tel:+440000000000">Call us</a>
<form action="/enquiry"><label for="e">Email</label><input id="e" type="email"><button>Get a quote</button></form></main>
<footer><a href="mailto:hello@example.com">Email</a><p>© 2026 ${n}</p></footer></body></html>`;
}
