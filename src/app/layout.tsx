import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import '../styles.css';
export const metadata:Metadata={title:'Forma — Your next first impression',description:'Create a professional portrait from five recent photos.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="en"><body>{children}</body></html>;}
