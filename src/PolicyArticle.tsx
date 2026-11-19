import type {ReactNode} from 'react';
import {legalInfo} from './legal-config';
export default function PolicyArticle({title,intro,children}:{title:string;intro:string;children:ReactNode}){return <main className="policy-main" id="main-content"><article className="policy-article"><a className="text-button" href="/">← Back to Forma</a><span className="eyebrow">FORMA / HELP & POLICIES</span><h1>{title}</h1><p className="policy-intro">{intro}</p><p className="policy-updated">Last updated <time dateTime={legalInfo.updated}>{legalInfo.updatedLabel}</time></p>{children}</article></main>;}
