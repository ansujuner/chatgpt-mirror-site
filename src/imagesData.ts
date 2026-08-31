export type ImageIdea = {
  id: string
  title: string
  image: string
  prompt: string
}

export const IMAGE_IDEAS: ImageIdea[] = [
  {
    id: "stickers",
    title: "贴纸",
    image: "/images-app/stickers-18de392f7686bfb1d3099d5196f05a69f915a95c3078b1f3f8d618dba2a21cae.webp",
    prompt: "Create a Meme sticker pack based on the images attached, remixing with 😎😛💕🚀🥳. Use exaggerated internet-reaction expressions, including crying, confusion, shock, smugness, side-eye, and deadpan disbelief, with awkward poses, low-fi cutout textures, and absurd humor.\n\n\n\n\nCreate a single square(1:1) transparent sticker sheet with nine distinct stickers arranged in a 3×3 grid, each showing a different expression, pose, or reaction. Separate the stickers with wide, fully transparent gaps. No background, shadows, or overlapping elements.",
  },
  {
    id: "caricature",
    title: "创建夸张漫画",
    image: "/images-app/caricature-6fdb81364a5794dc085c7fd8b49e116befbd101b39d3c903bca99129d51bd33a.webp",
    prompt: "根据你对我的一切了解，创建一幅关于我和我工作的漫画肖像。",
  },
  {
    id: "anime",
    title: "动漫",
    image: "/images-app/anime-sheet-jp.webp",
    prompt: "根据上传的主体，创作一张当下流行的动漫艺术风格图像。使用自信有力、略有变化的线条，以及用平面阴影块呈现的少量赛璐璐阴影。使用明亮、高饱和的色彩和干净的图形化打光。风格应以夸张、卡通化的人物比例为特征，搭配极富表现力的简洁面部特征，展现极大的情绪幅度，并配合高度变化、拉伸感强的身体结构。将环境转化为略微扭曲的空间，加入俏皮的透视畸变和简化的物体。构图和整体基调应充满活力、生动且诙谐，呈现一个完全风格化、非写实的世界。",
  },
  {
    id: "underwater",
    title: "水下",
    image: "/images-app/underwater-sheet-jp.webp",
    prompt: "创作一张人物刚跳入泳池或清澈浅水后拍摄的超近距离水下肖像。保持平静、失重、空灵的氛围，突出光线反射。不要表现挣扎或紧迫感。",
  },
  {
    id: "pin-collection",
    title: "置顶合集",
    image: "/images-app/pin-collection-34b419410824b90fed76556057d79f55a58cfd5c4734417add1c8f28954abbf3.webp",
    prompt: "根据你对我和我的兴趣的了解，创建一套 8 枚超写实插画风珐琅徽章，置于 4x5 图像中。1 枚中号徽章是我的肖像，1 枚小号徽章是描述我的词，1 枚小号徽章是我的名字。风格要大胆、扁平、色彩鲜亮、吸睛。如果你对我了解还不够，就从照片中提取线索。",
  },
  {
    id: "white-lines",
    title: "手写批注风格",
    image: "/images-app/white-lines-jp.webp",
    prompt: "在图片上叠加手绘效果。最终成品要时髦、松弛、毫不刻意地随性。绘制规则：使用细细的手绘线条，像是用白色笔画出来的一样。保持一笔画风格：粗糙、略微不均匀。沿着物体外轮廓添加描边。用箭头或虚线引导观者视线。文字规则：手写文字。保持简短，像随意的内心独白。语气：像日记，简短并聚焦情绪。评论要积极、甜美。装饰：少量加入蒸汽、闪光、爱心、小表情脸。不要加太多；留一些“留白”。",
  },
  {
    id: "mid-century",
    title: "室内设计",
    image: "/images-app/mid-century-sheet-jp.webp",
    prompt: "把这张图变成逼真的中世纪现代风格室内空间，线条简约利落，材质温润自然，家具极具雕塑感，以明亮自然且富有电影感的光线凸显房间肌理。整体保持照片级写实质感，呈现高端杂志大片级的室内摄影效果。",
  },
  {
    id: "disco-mode",
    title: "迪斯科风",
    image: "/images-app/disco-mode-sheet.webp",
    prompt: "把上传的图像变成华丽的迪斯科球版本，同时保留原始轮廓、构图、关键可辨特征和细腻的色调。将主体处理成由细小镜面方砖拼成的样子，像 1970 年代的迪斯科球：镀铬、银色、反光玻璃、斜切边缘，以及砖块之间细微的缝线。在镜面表面加入明亮的白色星芒闪光和少量虹彩高光。使用纯黑背景下的戏剧化影棚灯光，呈现高对比、光泽反射和奢华夜店氛围。保持物体居中且具有标志性，并带有精致的 3D 质感。",
  },
  {
    id: "app-design",
    title: "应用设计",
    image: "/images-app/ui-sketch-sheet.webp",
    prompt: "创建一张 5.5x3 的新应用样机图，强调设计感并采用统一的设计系统。展示 1 个不含摄影图片的移动端欢迎页、1 个移动端首页，以及 2 个产品或服务页面。样机图中不要包含任何其他元素。生成前，先问我应用名称、用途，以及我想要的审美风格。",
  },
  {
    id: "3d-avatar",
    title: "3D 头像",
    image: "/images-app/3d-avatar-sheet-jp.webp",
    prompt: "使用上传的图片作为唯一参考，为主体生成高级、亮面质感的 3D“潮流玩偶”渲染图。每人仅渲染一个悬浮头部（不要重复），在下颌下方干净裁切，露出颈部，并让整个头部完整、舒适地纳入画面。风格：高品质软胶公仔，造型极致顺滑且简化，体积圆润，面部关键区域带有强烈的光泽反射。头发应呈雕塑感、带有光泽并经过风格化处理，同时嵌入俏皮的配饰。加入夸张的复古包覆式太阳镜，镜框与镜片颜色鲜艳且相互协调。使用强烈的棚拍灯光，打造明显高光。背景：带有柔和云朵的蓝天。",
  },
  {
    id: "logo-design",
    title: "标识设计",
    image: "/images-app/icon-sheet.webp",
    prompt: "把这张图片转换为一组极简 Logo 网格，以主体作为核心图标。将主要元素抽象并简化为多个独特的矢量风格 Logo 标记。每个变体都应以不同方式重新诠释同一主体（几何、线稿、负空间、徽记、徽章、字母组合）。在浅色背景上均匀排列 16–20 个 Logo。保持设计简洁、现代、间距均衡。在保持一致性的同时，探索原始主体的创意变化，形成一组连贯的品牌 Logo 系列。",
  },
  {
    id: "relight",
    title: "修正光线",
    image: "/images-app/universal-lighting-sheet-jp.webp",
    prompt: "在保持其他一切完全不变的前提下改善光线。不要改变人物、姿势、表情、背景或构图。修复逆光、阴影过重、曝光不足或光线不均等问题。将原始光线调整为从略高于视线、朝向主体照射的柔和、自然、衬托人物的光线，使面部受光均匀、肤色真实自然。保持结果具备照片级真实感，并与原始场景一致。",
  },
  {
    id: "headshot",
    title: "影棚形象照",
    image: "/images-app/headshot-sheet-jp.webp",
    prompt: "把这张照片转换成高级时尚风格的影棚人像。选择与主体肤色相衬、能提升气色的背景颜色。保持紧凑的头肩构图，让主体居中，正对镜头，并展现乐观的神情。采用定向布光，配以细微阴影。在保留自然肤色的同时，让画面呈现精致、极简、富有杂志 editorial 感的效果，如同时尚杂志拍摄。",
  },
  {
    id: "chibi-stickers",
    title: "Chibi 贴纸",
    image: "/images-app/sticker-sheet.webp",
    prompt: "使用上传的照片，制作一套可爱的Q版插画贴纸包。干净的白色背景，竖版输出，带粗白边。创作多种可爱表情：大笑、哭哭、犯困、惊讶、疑惑、吃东西、闹脾气、卖萌…每个表情都配上可爱文字，例如：早安呀！/ 啥啊啊？/ 哈？/ 我在提醒你哦！/ 好困哦 / 哇！通过啦！/ 不错耶！/ 喂你！阿嚏！/ 生气啦！/ 哈？？？/ 晚安啦 :3 / 可爱爆了啦 / 我现在够酷了吗？！",
  },
  {
    id: "cross-section",
    title: "剖面图",
    image: "/images-app/cross-section-sheet.webp",
    prompt: "将上传图片的主体转换成白色背景、干净利落的教育类剖面示意图。保留原图主体的显著特征，展示可信的剖面或分层内部结构，并添加清晰的带标签引注。整体效果应像教科书或博物馆中的科学图解，优先保证清晰性和准确性，而不是追求戏剧化或艺术化风格。",
  },
  {
    id: "makeup-guide",
    title: "美妆指南",
    image: "/images-app/makeup-analysis-sheet.webp",
    prompt: "根据我上传的人像照片，制作一张高质量的“妆容分析指南”信息图。整体风格要专业、简洁，像现代美妆杂志专题。以这张上传照片为基础，不过度修饰，保留人物真实面部特征和可辨识度。以突出重点的视觉呈现为主，文字尽量少，避免长段落。使用 9:16 比例。",
  },
  {
    id: "enhance",
    title: "增强照片",
    image: "/images-app/enhance-sheet-jp.webp",
    prompt: "提升我的照片画质，让它更清晰。",
  },
  {
    id: "mini-me",
    title: "迷你分身",
    image: "/images-app/mini-me-global-sheet.webp",
    prompt: "把这张照片变成一个充满魔法的“迷你我”世界，让微型动画版的你在身边鲜活起来。这些可爱的 3D 风格迷你角色会与你的日常环境互动——爬上你的肩膀、坐在你的包上、挥手、玩耍、模仿你的姿势——营造出一个俏皮又富有情感、适合社交媒体分享的场景，充满个性与故事感。原始照片保持不变，而这些小小角色则以层次感、动态、真实阴影和柔和美学氛围让画面鲜活起来。",
  },
  {
    id: "wanderlust",
    title: "远方情结",
    image: "/images-app/wanderlust-postcard-sheet.webp",
    prompt: "用这张图片制作一幅旅行拼贴画：将原图的主体放入一张拍立得风格的照片中，并把这张照片置于旅行目的地场景里，场景风格要与地点相符；拍立得风格的光线、色彩和质感只用于这张照片。加入一张来自某个较少人涉足目的地的明信片，明信片上用蓝色墨水手写一句鼓励我去新地方旅行的话。整体感觉应当亲密、个人化，并且整洁而经过用心安排。再加入纪念品和一些小细节，在自然光下以平衡的布局营造出旅行纪念物般的感觉。",
  },
  {
    id: "scribble",
    title: "涂鸦",
    image: "/images-app/scribble-sheet.webp",
    prompt: "重画附图，使用最大的色块、涂鸦感更重，尽可能弄得惨兮兮的。用白底，做得像是在老式电脑画图程序里拿鼠标画出来的。要隐约有点像，但又不太像，像是对上了又哪哪都不对，别扭得让人迷惑，呈现那种低清、一像素一像素蹭出来的感觉，突出它到底有多离谱地烂。算了，随便吧，你想怎么画就怎么画。",
  },
]
