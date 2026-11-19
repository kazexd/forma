export const legalInfo={
 operator:'Zephyr Wong',
 location:'Ontario, Canada',
 email:process.env.SUPPORT_EMAIL?.trim()||'forma.portraits@gmail.com',
 updated:'2026-11-19',
 updatedLabel:'November 19, 2026'
} as const;
export const supportMailto=(subject='Forma support')=>'mailto:'+legalInfo.email+'?subject='+encodeURIComponent(subject);
