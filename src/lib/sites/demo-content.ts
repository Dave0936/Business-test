import type { Industry } from "@/lib/industries";
import type { DesignBrief } from "@/lib/design/brief";
import type { SiteContent, Section } from "./spec";

/**
 * Deterministic content used when AI is not configured. Generic and claim-free by
 * construction: it describes the *type* of business, never this business's track record.
 */
const SERVICES: Record<string, { name: string; description: string }[]> = {
  food: [
    { name: "Lunch and dinner", description: "Seasonal dishes cooked to order, with options for most dietary needs." },
    { name: "Private dining", description: "Space for celebrations and get-togethers. Ask about availability." },
    { name: "Takeaway", description: "Favourites from the menu, ready to collect." },
  ],
  hospitality: [
    { name: "Rooms", description: "Comfortable rooms for short breaks and longer stays." },
    { name: "Breakfast", description: "Start the day well before heading out." },
    { name: "Local guidance", description: "Ideas for what to see and where to eat nearby." },
  ],
  beauty: [
    { name: "Treatments", description: "A range of treatments tailored to you after a short consultation." },
    { name: "Consultations", description: "Talk through what you'd like and what will suit you." },
    { name: "Gift vouchers", description: "A thoughtful present for someone special." },
  ],
  healthcare: [
    { name: "Check-ups", description: "Routine examinations to keep on top of your health." },
    { name: "Treatments", description: "Care planned around your needs, explained clearly." },
    { name: "Urgent appointments", description: "Get in touch if something can't wait." },
  ],
  trades: [
    { name: "Repairs", description: "Diagnosis and repair, explained before any work starts." },
    { name: "Installations", description: "New fittings and installations, done neatly." },
    { name: "Maintenance", description: "Regular servicing to prevent bigger problems." },
  ],
  automotive: [
    { name: "Servicing", description: "Routine servicing to keep your car running well." },
    { name: "Repairs", description: "Diagnosis and repair, with costs agreed first." },
    { name: "Inspections", description: "Pre-purchase and safety checks." },
  ],
  property: [
    { name: "Sales", description: "Help selling your home, from valuation to completion." },
    { name: "Lettings", description: "Finding tenants and managing the details." },
    { name: "Valuations", description: "A clear view of what your property could achieve." },
  ],
  fitness: [
    { name: "Gym access", description: "Equipment for strength and conditioning." },
    { name: "Classes", description: "Group sessions for different levels." },
    { name: "Personal training", description: "One-to-one sessions built around your goals." },
  ],
  professional: [
    { name: "Advice", description: "Clear guidance on the decisions in front of you." },
    { name: "Ongoing support", description: "Help throughout the year, not just at deadlines." },
    { name: "First consultation", description: "A conversation to understand what you need." },
  ],
  services: [
    { name: "Regular service", description: "Scheduled visits that fit around you." },
    { name: "One-off jobs", description: "For moving days, events or a fresh start." },
    { name: "Commercial", description: "Options for offices and business premises." },
  ],
  retail: [
    { name: "In store", description: "Come in and browse the current range." },
    { name: "Gifts", description: "Ideas for presents, wrapped on request." },
    { name: "Orders", description: "Ask about ordering something specific." },
  ],
};

export function demoContent(businessName: string, city: string | null, industry: Industry | undefined, brief: DesignBrief): SiteContent {
  const sector = industry?.sector ?? "professional";
  const kind = industry?.label.replace(/s$/, "").toLowerCase() ?? "business";
  const where = city ? ` in ${city}` : "";
  const booking = industry?.bookingRelevant ?? false;
  const primary = { label: brief.ctas[0]?.label ?? "Get in touch", target: booking ? ("booking" as const) : ("contact" as const) };
  const services = SERVICES[sector] ?? SERVICES.professional;

  const home: Section[] = [
    { type: "hero", heading: `${businessName}`, subheading: `A ${kind}${where}. Find out what we offer and get in touch in a couple of taps.`, primary_cta: primary, secondary_cta: { label: "Our services", target: "services" }, image_query: brief.image_queries[0] ?? kind },
    { type: "services", heading: "What we offer", intro: `An overview of what you can expect from ${businessName}.`, items: services },
    { type: "features", heading: "Why visit us", items: [
      { title: "Easy to reach", text: "Call, email or send a message from any page." },
      { title: "Local", text: city ? `Based${where} and easy to find.` : "Close to you and easy to find." },
      { title: "Clear and simple", text: "Straightforward information so you know what to expect." },
    ] },
    { type: "gallery", heading: "A closer look", image_queries: brief.image_queries.slice(0, 4).length >= 3 ? brief.image_queries.slice(0, 4) : [kind, `${kind} interior`, `${kind} detail`] },
    { type: "cta", heading: booking ? "Ready to book?" : "Have a question?", text: "Send a message and we'll get back to you.", cta: primary },
  ];
  const pages: SiteContent["pages"] = [
    { slug: "index", nav_label: "Home", title: `${businessName}${where}`, meta_description: `${businessName}, a ${kind}${where}. Services, information and contact details.`, sections: home },
    { slug: "services", nav_label: "Services", title: `Services · ${businessName}`, meta_description: `Services offered by ${businessName}${where}.`, sections: [
      { type: "text", heading: "Services", paragraphs: [`Here is an overview of what ${businessName} offers. Get in touch for details.`] },
      { type: "services", heading: "Our services", intro: "Ask us about anything you don't see here.", items: services },
      { type: "cta", heading: "Talk to us", text: "We'll help you work out what you need.", cta: primary },
    ] },
    { slug: "about", nav_label: "About", title: `About · ${businessName}`, meta_description: `About ${businessName}${where}.`, sections: [
      { type: "text", heading: `About ${businessName}`, paragraphs: [`${businessName} is a ${kind}${where}.`, "This concept page is where the business's own story would go, written with the owner."] },
    ] },
    { slug: "contact", nav_label: "Contact", title: `Contact · ${businessName}`, meta_description: `Contact ${businessName}.`, sections: [
      { type: "contact", heading: "Get in touch", text: "Send a message using the form, or use the details below." },
    ] },
  ];
  if (booking) {
    pages.push({ slug: "booking", nav_label: "Book", title: `Book · ${businessName}`, meta_description: `Request a booking with ${businessName}.`, sections: [
      { type: "booking", heading: "Request a booking", text: "Choose a time that suits you and we'll confirm.", fields: sector === "food" ? ["date", "time", "party_size", "notes"] : ["date", "time", "service", "notes"] },
    ] });
  }
  return {
    tagline: `${industry?.label.replace(/s$/, "") ?? "Local business"}${where}`,
    seo_title: `${businessName}${where}`.slice(0, 65),
    seo_description: `${businessName}, a ${kind}${where}. See services and get in touch.`.slice(0, 160),
    pages,
  };
}
