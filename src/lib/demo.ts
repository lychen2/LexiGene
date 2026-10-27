import { analysisSchema, type AnalysisDocument } from './schema';

export const demo: AnalysisDocument = analysisSchema.parse({
  schemaVersion: 1,
  id: 'demo-anagnorisis',
  createdAt: '2026-02-14T09:20:00.000Z',
  target: 'anagnorisis',
  language: '美式英语',
  dimensions: {
    one: {
      overview: {
        pronunciation: '/ˌænəɡˈnɔːrɪsɪs/，复数 anagnorises /ˌænəɡˈnɔːrɪsiːz/',
        core: '认出真相，也重新认出彼此。',
        definition:
          '叙事中从不知到知的转折：人物认出一个人、一段关系，或终于看清自己的处境。它可以描写亲缘相认、误会化解与重新理解自己的时刻，强调新认识如何改变之后的选择。主要用于文学批评、剧本分析和文学性叙述。',
        partOfSpeech: 'noun · 名词（文学批评术语，可数；书面语域）',
      },
      origin: {
        story:
          'anagnorisis 直接来自希腊语 ἀναγνώρισις，意思是“认出”。这个词由 ἀνά-（再、回）加 γνωρίζειν（使知道、认出）构成，字面上就是“再认一遍”：把已经发生、却一直没被看懂的事重新认一次。希腊戏剧里，认出的常常是一个人——比如厄勒克特拉在父亲坟前认出弟弟俄瑞斯忒斯，两个孤立的人从此有了彼此——也可以是这个人所代表的东西。亚里士多德在《诗学》里把它固定成一个结构概念：从不知到知的转变，而且最好的形式是与突转同时发生。后来英语把整个希腊词借进批评语汇，专指这一次改写认知、也改写关系的时刻。',
        physicalImage:
          '手里攥着几张撕碎的照片，怎么摆都不对；某个角度一转，中间那张脸连起来，原来一直是他自己的脸。',
        evolution: [
          {
            id: 'greek-verb',
            label: '希腊语 ἀναγνωρίζειν',
            period: '古希腊语',
            meaning: '“认出、承认、发现”，把某人重新认出来。',
            connection:
              'ἀνά-（再、回）+ γνωρίζειν（使知道、认出）：认的动作里带着“回头再看”的意思，所以认出总是指向此前已经存在、只是没被看清的东西。',
            example: {
              en: 'ἀνεγνωρίσθη Ἰωσὴφ τοῖς ἀδελφοῖς αὐτοῦ — “Joseph was recognized by his brothers.”',
              zh: '《新约·使徒行传》7:13：约瑟被他的哥哥们认了出来。这里用的正是这个动词。',
            },
          },
          {
            id: 'poetics',
            label: '亚里士多德《诗学》',
            period: '公元前4世纪',
            meaning: '“从不知到知的转变”，并且最好与突转同时发生。',
            connection:
              '《诗学》第11章把“认出”与“突转”并列为情节的两种核心事件，并指出认出会让相关人物之间“生出爱或恨”——认出的同时，关系被重新确定。亚里士多德给出的标准例子是《俄狄浦斯王》：报信人本意是安慰，却揭开了身世，认知与命运的反转落在同一拍上。',
            example: {
              en: 'Recognition, as the name indicates, is a change from ignorance to knowledge, producing love or hate between the persons destined by the poet for good or bad fortune.',
              zh: '“所谓‘认出’，顾名思义，是从不知到知的转变，并让诗人安排了好运或厄运的两个人之间生出爱或恨。”——《诗学》第11章，S. H. Butcher 英译（1902；MIT Classics 版）。',
            },
          },
          {
            id: 'loanword',
            label: '英语批评术语 anagnorisis',
            period: '进入英语之后',
            meaning: '直接借自希腊语，主要出现在诗学、戏剧与文学批评的讨论里，也见于文学性的个人叙述；复数是 anagnorises。',
            connection:
              '它不是从法语或拉丁语一路演变来的日常词，而是学者为了谈《诗学》整词搬过来的术语，所以拼写一直保留希腊形状，读音也按希腊—学术传统走。',
            example: {
              en: 'Anagnorisis came into English as a term of criticism, and it has stayed one.',
              zh: 'anagnorisis 是作为批评术语进入英语的，也一直留在这个语域里。',
            },
          },
          {
            id: 'modern',
            label: '现代用法',
            period: '现代',
            meaning: '从悲剧扩展到小说、电影与悬疑：人物认出凶手、认出亲人，或认出自己一直误判的处境。',
            connection:
              '核心没有变，仍是“认知被改写”的那一刻；变的只是体裁与媒介。所以它可以出现在侦探小说的最后一章，也可以出现在剧集的最后一镜。',
            example: {
              en: 'The film saves its anagnorisis for the final scene, and it makes everything before it mean something else.',
              zh: '这部电影把“认清”留到最后一幕，而它让之前的一切都换了一层意思。',
            },
          },
        ],
      },
      bloodline: {
        family: '希腊认知词族',
        route: ['ἀνά-（再、回）', 'γιγνώσκειν（知道）', 'ἀναγνώρισις（认出）', 'anagnorisis（认知转折）'],
        socialFeel:
          '今天的 anagnorisis 主要出现在论文、剧评与剧本会上：用它，说明你在谈结构，而不是在谈心情。它偶尔也出现在文学性的个人叙述里——“很多年后我才认出父亲那一面”——语域偏书面、偏学术；放在随口闲聊里会显得郑重，不是不能说，只是要想清楚为什么用这个词。',
        root: 'gnō-',
        cognates: [
          {
            word: 'diagnosis',
            meaning: '诊断；判断',
            connection:
              '同为希腊 γιγνώσκειν（知道）词族：διά-（分开）+ γνῶσις（知），把症状分开来认，经希腊语 διάγνωσις 进入医学英语。它与 anagnorisis 共享词根，不是从 anagnorisis 派生出来的。',
          },
          {
            word: 'prognosis',
            meaning: '预后；对病程的预判',
            connection:
              '同族词：πρό-（在前）+ γνῶσις（知），提前知道走向。记忆上可以想成“医生先把后面的事认一遍”，但历史上的构词只到“预先知道”为止。',
          },
          {
            word: 'agnostic',
            meaning: '不可知论者；不可知的',
            connection:
              '同族词：a-（不）+ γνωστός（可知的），字面就是“不可知”。它否定的是可知性，与“认出”的方向相反。',
          },
          {
            word: 'gnosis',
            meaning: '灵知；秘传的知识',
            connection:
              'γνῶσις 的直接借用，诺斯替派（Gnosticism）由此得名。它指知识本身，不指认知发生转变的那一刻。',
          },
        ],
      },
    },
    two: {
      concept: {
        scene:
          '剧场或书房里，那个“原来是你”的瞬间：长时间的误认之后，人物终于认出对方是谁——失散的亲人、一直匿名帮他的人、被他错怪多年的伴侣。认出的同时，断掉的关系重新接上：《李尔王》里父亲终于看清两个女儿，很多小说的结尾也让孤儿认出一直暗中护着他的人。灯没变，台词没变，人物看对方、也看自己的方式变了。',
        trigger:
          '一条新信息——一封信、一个证人、一块伤疤、一张旧照片——让此前解释不通的细节同时归位；归位之后，他既要知道“这是谁”，也要重新回答“我们之间算什么”。缺了后面这一步，就只是知道了一件事。',
        psychology:
          '先是不敢确认，接着细节连锁对上；确认之后，先前积下的误会、亏欠与提防都得重新结算。所以那一刻往往又轻又重：轻的是误会终于放下，重的是他得承认自己曾经看错、错怪过谁。好的 anagnorisis 让“知道”和“关系重新成立”同时发生。',
        intensity:
          '属于结构级事件，不按音量计：分量取决于改写范围——只是认出一个陌生人，还是认回一个被自己推开多年的人。它比 surprise 深，也比日常的 realization 重。',
        boundary:
          '不是所有“忽然想到”都算：产品灵感、写作灵光用 epiphany 或 inspiration；被消息吓到用 shock；只揭给观众看的用 reveal 或 plot twist；行动整个转向反面才是 peripeteia。它也不等于 catharsis——那是观众的情绪得到疏泄。它也不是“大团圆”的同义词：认出之后可以和解，也可能走向决裂，词本身只保证认知和关系被重新算过。',
        translation: {
          common: '相认／认出／认知转折',
          adds:
            '“相认”保住了亲缘认出与关系重新成立这一层，“认知转折”保住了结构位置；剧评里也常见“真相大白”，那更偏把情节向观众公开。',
          misses:
            '这几个说法都不强制“重新理解自己”这一层。anagnorisis 的关键不是多知道一条消息，而是旧理解被推翻、关系要重新结算；中文往往要再补一句“他才明白自己把谁错认成了谁”，意思才落得下来。',
        },
      },
      nuance: {
        sharedScene:
          '同一部电影的最后十分钟：她终于认出，一直匿名替她挡事的人，正是当年那封信的作者。下面四个词说的都是这个瞬间，但各自站的位置不同。',
        words: [
          {
            word: 'anagnorisis',
            image: '舞台后方那张一直背对观众的脸，忽然转了过来。',
            register: 9,
            distinction:
              '术语，用于叙事分析：人物从不知到知的转变，常与突转同时发生，重点在旧理解被推翻、人物关系重新结算。',
            example: {
              en: "The film's anagnorisis is not the confession; it is the moment she realizes who wrote the letter.",
              zh: '这部片子的“认知转折”不在认罪那场，而在她意识到信是谁写的那一刻。',
            },
          },
          {
            word: 'epiphany',
            image: '街角忽然亮起的一束光，照见平常事物的另一面。',
            register: 7,
            distinction:
              '顿悟可以关于意义、美感或信仰，不必纠正身份错认，也不一定改变情节走向；它更偏“看见”，anagnorisis 更偏“知道自己一直错了”。',
            example: {
              en: 'He had an epiphany about his father on an ordinary bus ride.',
              zh: '在一次平常的公交车上，他忽然对父亲有了新的理解。',
            },
          },
          {
            word: 'recognition',
            image: '在人群里对上一张脸，然后叫出名字。',
            register: 5,
            distinction:
              '日常义是“认出、承认”，对象可以是脸、笔迹、功劳；《诗学》英译正是用它来对应 anagnorisis，但日常的 recognition 不承担结构分析的重量。',
            example: {
              en: 'Her recognition of the handwriting came before she read the signature.',
              zh: '她先认出了笔迹，然后才看到签名。',
            },
          },
          {
            word: 'realization',
            image: '口袋里摸到一直在找的那把钥匙。',
            register: 5,
            distinction:
              '最日常的“明白过来”，可大可小，可以只是发现自己记错了时间；单说 realization，听不出叙事结构和自我重估。',
            example: {
              en: 'His realization that the keys were in his coat ended the search.',
              zh: '他想起钥匙就在外套里，翻找就这么结束了。',
            },
          },
        ],
      },
    },
    three: {
      register: {
        score: 9,
        persona: '文学批评、戏剧研究与深度影评的写作者；课堂上讲《诗学》的人。',
        prosody: 'neutral',
        prosodyExplanation:
          '作为分析术语，它本身不带褒贬：可以写悲剧里毁灭性的认清，也可以写喜剧里团圆的相认。情绪由作品给，不由这个词给。',
        subtext: '我在谈结构，不在谈心情：这一刻之后，人物和读者都得重读前面的一切，关系也得重新算一遍。',
        levels: [
          {
            level: 1,
            label: '粗俗与禁忌表达',
            candidates: [],
          },
          {
            level: 2,
            label: '同龄人俚语与口头叙事',
            candidates: [
              {
                word: 'it hits you',
                nuance: '极口语的叙述句，讲到一半来一句 Then it hits you，把听的人拉进“明白的那一下”。',
                persona: '给朋友复述剧情、讲自己经历的人。',
                prosody: 'neutral',
                shift:
                  '它只负责“忽然明白”这个瞬间，不追问明白了什么，也没有“重新理解自己”的结构重量；文本分析里不会用它来指 anagnorisis。',
                example: {
                  en: 'Then it hits you: the man at the door was her father.',
                  zh: '然后你忽然明白：门口那个人是她父亲。',
                },
              },
            ],
          },
          {
            level: 3,
            label: '日常口语：把线索拼起来',
            candidates: [
              {
                word: 'put two and two together',
                nuance: '靠手上的线索自己推出结论，重点在“拼”。',
                persona: '同事、朋友之间讲自己是怎么发现的。',
                prosody: 'neutral',
                shift:
                  '它强调的是推理与证据，结论可以只是“账对不上”；anagnorisis 要的是对身份或处境的理解被改写，而且通常是故事安排好的那一刻。',
                example: {
                  en: 'She put two and two together when the same name showed up in both files.',
                  zh: '两个文件里出现同一个名字，她就把事情拼起来了。',
                },
              },
              {
                word: 'it clicks',
                nuance: '“咔”一下对上了；可以指看懂一句话、学会一个操作，也可以指突然看懂一个人。',
                persona: '日常闲聊、课堂上的学生。',
                prosody: 'neutral',
                shift:
                  '范围比术语宽得多：语法、技能、谜题都能 click；一旦拿它替换 anagnorisis，结构分析那一层就丢了。',
                example: {
                  en: 'The grammar finally clicked when she stopped translating in her head.',
                  zh: '她不再在脑子里逐字翻译之后，语法忽然就通了。',
                },
              },
            ],
          },
          {
            level: 4,
            label: '通俗影评与内容写作',
            candidates: [
              {
                word: 'the big reveal',
                nuance: '影视和播客里指把真相摊给观众的那一幕，带一点节目化的语气。',
                persona: '聊剧、写推送、做视频解说的人。',
                prosody: 'neutral',
                shift:
                  '落点在“信息被公开”的时机，受益者是观众；anagnorisis 必须发生在人物身上，观众完全可能早就知道。',
                example: {
                  en: 'The big reveal lands in the last ten minutes, after everyone has stopped suspecting him.',
                  zh: '大揭秘落在最后十分钟——那时所有人都不再怀疑他了。',
                },
              },
            ],
          },
          {
            level: 5,
            label: '中性基准：认出这个动作',
            candidates: [
              {
                word: 'recognition',
                nuance: '最中性的“认出、承认”，从认脸、认笔迹到认功劳都能用。',
                persona: '任何成年场合；日常叙述、新闻、评论里都常见。',
                prosody: 'neutral',
                shift:
                  '它只保证“认出来了”，不保证这是故事的转折点，也不保证旧理解被推翻；《诗学》英译用它对应 anagnorisis，但日常的 recognition 少了结构那一层。',
                example: {
                  en: 'Recognition came slowly: first the voice, then the face.',
                  zh: '认出是慢慢来的：先认出声音，再认出脸。',
                },
              },
            ],
          },
          {
            level: 6,
            label: '略偏书面：批评与教学用语',
            candidates: [
              {
                word: 'recognition scene',
                nuance: '戏剧与小说分析里的常规说法：人物认出对方或认清处境的那一场。',
                persona: '剧评人、文学课教师、剧本编辑。',
                prosody: 'neutral',
                shift:
                  '它是场景单位的名字，可以只是“认出一个人”；anagnorisis 是那个认知转变本身，更强调它如何改写整部作品。',
                example: {
                  en: 'The recognition scene in Act Five turns on a letter and a birthmark.',
                  zh: '第五幕那场“认出戏”靠一封信和一块胎记成立。',
                },
              },
              {
                word: 'moment of recognition',
                nuance: '把 anagnorisis 用平常英文说出来的方式，论文与影评里都读得通。',
                persona: '写分析、做课堂讲解的人。',
                prosody: 'neutral',
                shift:
                  '字面清楚，但少了术语的历史分量；同一段里要和 peripeteia 并列时，通常还是回到 anagnorisis。',
                example: {
                  en: 'The moment of recognition arrives without music, which makes it harder to watch.',
                  zh: '“认出”的那一刻没有配乐，反而更难直视。',
                },
              },
            ],
          },
          {
            level: 7,
            label: '正式书面语',
            candidates: [
              {
                word: 'epiphany',
                nuance: '忽然的领悟或显现，可以关于意义、美感、信仰，也可以是日常生活里的一闪。',
                persona: '书评、随笔、访谈里的作者。',
                prosody: 'neutral',
                shift:
                  'epiphany 不要求情节里的身份错认被纠正，也不要求改写人物关系；它更关于“看见意义”，anagnorisis 更关于“知道自己一直弄错了什么”。',
                example: {
                  en: "Joyce's stories treat ordinary moments as epiphanies.",
                  zh: '乔伊斯的小说把日常瞬间写成顿悟。',
                },
              },
              {
                word: 'revelation',
                nuance: '真相被揭开，语气正式；可指宗教启示，也可指调查得出的结论。',
                persona: '报道、书评、论文的作者。',
                prosody: 'neutral',
                shift:
                  '侧重“信息被揭开”这件事，可以只对读者生效；anagnorisis 是人物自己的认知转折，还要改变他对处境的判断。',
                example: {
                  en: 'The final revelation reframes every conversation the narrator has reported.',
                  zh: '最后的真相一揭开，叙述者转述过的每场对话都变了意思。',
                },
              },
            ],
          },
          {
            level: 8,
            label: '高度正式的论述',
            candidates: [
              {
                word: 'denouement',
                nuance: '结局的“解结”：线索收拢、误会解开的那一段，来自法语。',
                persona: '文学与戏剧评论、剧本分析。',
                prosody: 'neutral',
                shift:
                  'denouement 说的是结构位置，anagnorisis 说的是认知事件；结局里可以没有认知，认知也可以提前发生在中段。',
                example: {
                  en: 'The denouement is quiet: two people, one table, nothing explained twice.',
                  zh: '结局很安静：两个人，一张桌子，什么都不再解释第二遍。',
                },
              },
            ],
          },
          {
            level: 9,
            label: '学术与文学批评术语',
            candidates: [
              {
                word: 'anagnorisis',
                nuance: '本词：人物从不知到知的转变；常落在亲缘相认、旧怨和解或自我看清的时刻，亚里士多德把它与突转并列为最好的结构。',
                persona: '文学批评、戏剧研究、深度影评的写作者。',
                prosody: 'neutral',
                shift: '无偏移——其他各档都以它所指的那次认知改写为参照。',
                example: {
                  en: 'The play withholds its anagnorisis until the messenger finally speaks.',
                  zh: '这出戏一直压着“认出”的那一刻，直到报信人终于开口。',
                },
              },
            ],
          },
          {
            level: 10,
            label: '古典语文学与注疏传统',
            candidates: [],
          },
        ],
      },
      chunks: {
        items: [
          {
            phrase: 'the moment of anagnorisis',
            meaning: '指认的那一刻本身；影评和论文都常用，前面常接 at 或 in。',
            example: {
              en: 'At the moment of anagnorisis, the stranger at the door becomes the brother she has been looking for.',
              zh: '在“认出”的那一刻，门口那个陌生人成了她找了半生的哥哥。',
            },
          },
          {
            phrase: 'a textbook case of anagnorisis',
            meaning: '教科书式的典型：某个场景把定义演示得很干净，几乎可以直接拿去讲课。',
            example: {
              en: 'The last chapter is a textbook case of anagnorisis: the letter, the date, the name.',
              zh: '最后一章是教科书式的“认知转折”：一封信、一个日期、一个名字。',
            },
          },
          {
            phrase: 'anagnorisis and peripeteia',
            meaning: '批评写作里常成对出现的两个概念：认知的转变与行动的突转，亚里士多德最看重它们同时落地。',
            example: {
              en: 'Aristotle prizes the plots where anagnorisis and peripeteia arrive on the same beat.',
              zh: '亚里士多德推崇那种“认知”与“突转”落在同一拍上的情节。',
            },
          },
          {
            phrase: 'stage an anagnorisis',
            meaning: '把这次认知转折排演出来、安排在某一场；stage 在这里是“呈现、调度”，小说作者也常借用。',
            example: {
              en: 'The director stages the anagnorisis as a silent beat: no letter, just a face.',
              zh: '导演把“认出”处理成一个无声的停顿：没有信，只有一张脸。',
            },
          },
          {
            phrase: 'withhold the anagnorisis',
            meaning: '压着不揭，把认知推到后面；常用来分析悬念与结构节奏。',
            example: {
              en: 'The novel withholds its anagnorisis until the narrator has nothing left to hide behind.',
              zh: '小说一直压着“认清”的那一刻，直到叙述者再没有东西可挡。',
            },
          },
        ],
        culture: [],
      },
      pitfalls: {
        items: [
          {
            wrong: 'The audience has an anagnorisis when the killer walks in.',
            right: 'The detective has an anagnorisis when the killer walks in; the audience gets a reveal.',
            explanation:
              'anagnorisis 的主语是剧中人：认知必须发生在他身上。观众先知道、人物后知道，那是 dramatic irony；把真相交给观众，那是 reveal 或 plot twist。',
            image: '舞台上的追光只照人物的脸，不照观众席。',
            translation: '凶手走进来时，侦探认出了他；观众得到的是一次真相揭晓。',
          },
          {
            wrong: 'I had an anagnorisis in the shower about my career.',
            right: 'I had an epiphany in the shower about my career.',
            explanation:
              '日常的灵光一现用 epiphany 或 realization。anagnorisis 属书面、学术语域，通常用来谈作品结构或叙事里的相认，偶尔出现在文学性的回顾里；把它用在洗澡时冒出的职业感想上，会像穿着戏服去上班。',
            image: '手术刀带去野餐：工具没错，场合错了。',
            translation: '洗澡的时候，我忽然想通了职业方向。',
          },
          {
            wrong: 'She anagnorised that the stranger was her brother.',
            right: "She recognized the stranger as her brother — the play's anagnorisis.",
            explanation:
              '英语里没有通行的动词 anagnorise/anagnorize。要写人物的动作，用 recognize 或 realize；要谈这个结构概念，用名词 anagnorisis，并让上下文说明这是分析。',
            image: '一扇只挂名词门牌的门，硬当动词推会卡住。',
            translation: '她认出那个陌生人就是自己的哥哥——这就是全剧的“认知转折”。',
          },
        ],
      },
      slices: {
        dialogues: [
          {
            setting: 'friends',
            title: '咖啡馆，电影散场之后',
            lines: [
              {
                speaker: 'Ana',
                en: 'Hold on. He was the one paying her rent the whole time?',
                zh: '等一下，一直替她付房租的人其实是他？',
                annotation: '先确认最关键的那条信息——观众常常在这一步才追上来。',
              },
              {
                speaker: 'Ben',
                en: "That's the anagnorisis. The whole film was built on her misreading him.",
                zh: '这就是“认知转折”。整部片子都建在她误读他这件事上。',
                annotation: 'That’s the anagnorisis 用来指认结构上的那一瞬，朋友之间这样聊，是因为两人都在谈叙事。',
              },
              {
                speaker: 'Ana',
                en: "So it's not a twist for us. We knew before she did.",
                zh: '所以对我们来说不算反转，我们比她先知道。',
                annotation: '把观众掌握的信息和人物的认知分开，正好划出这个词的边界。',
              },
              {
                speaker: 'Ben',
                en: 'Right. That is dramatic irony doing the work until she catches up — and then the two of them can finally talk.',
                zh: '对。在她追上来之前，撑住戏的是戏剧反讽；等她追上了，两个人才终于能说话。',
                annotation: 'dramatic irony 与 anagnorisis 常被对照：一个在观众这边，一个在人物那边；追平之后，关系才重新开始。',
              },
            ],
          },
          {
            setting: 'work',
            title: '编剧室，第五集拆解',
            lines: [
              {
                speaker: 'Showrunner',
                en: 'Where does he learn the truth?',
                zh: '他是在哪儿知道真相的？',
                annotation: '编剧室最常问的结构问题：这个认知放在哪一集、哪一场。',
              },
              {
                speaker: 'Writer',
                en: 'Page forty. We had it in the cold open, but it killed the episode.',
                zh: '第四十页。原来放在冷开场，结果整集都塌了。',
                annotation: 'cold open 是美剧里正片之前的开场段，信息太早给完，后面就没了张力。',
              },
              {
                speaker: 'Showrunner',
                en: 'Move the anagnorisis to the dinner scene, and let the brother say it.',
                zh: '把“认清”挪到晚饭那场，让哥哥说出来。',
                annotation: '这里把 anagnorisis 当结构单元用，和 scene 搭配，正是剧本会上的说法。',
              },
              {
                speaker: 'Writer',
                en: 'Then the peripeteia lands on the same beat. That works.',
                zh: '那突转就落在同一拍上。这样成立。',
                annotation: '两个术语并列出现，对应《诗学》里最受推崇的那种结构。',
              },
            ],
          },
          {
            setting: 'culture',
            title: '播客录音间：为什么还留着这个希腊词',
            lines: [
              {
                speaker: 'Host',
                en: 'Why keep a Greek word when "realization" is right there?',
                zh: '有 realization 这样的词摆在那儿，为什么还要留着一个希腊词？',
                annotation: '这是读者最常提的疑问，答案在两者的语义范围上。',
              },
              {
                speaker: 'Guest',
                en: 'Because realization can be small. You realize the keys are in your coat.',
                zh: '因为 realization 可以很小——你发现钥匙就在外套口袋里。',
                annotation: '日常词范围大；术语要的是那个会改写整部作品的认知事件。',
              },
              {
                speaker: 'Guest',
                en: 'Anagnorisis means the story reorganizes itself around what the character now knows — and around whom he can finally recognize.',
                zh: 'anagnorisis 的意思是：故事要围绕人物现在知道的事、以及他终于认出的那个人重新组织自己。',
                annotation: '关键在 reorganize：认知落地之后，前面的情节和人物关系都得重新读。',
              },
              {
                speaker: 'Host',
                en: 'So it is less a feeling than a hinge.',
                zh: '所以它更像一个铰链，而不是一种情绪。',
                annotation: 'hinge 这个比喻把术语的结构属性说清楚了。',
              },
            ],
          },
        ],
        quiz: [
          {
            id: 'q-family-letters',
            scenario:
              '读完小说最后一章：女主人公终于认出，多年来匿名资助她读书的人，正是她一直误以为抛弃了全家的舅舅。两人在旧屋门口相认，多年积下的怨气当场松开。',
            challenge: '用 anagnorisis 写两句话：一句点出认出的那一下，一句说明它怎样改变了两个人之间的关系。',
            focus:
              '让术语落在人物的认知上：用 the anagnorisis comes when... 起句，再写出认出之后关系怎么重新成立。',
            reference: {
              en: 'The anagnorisis comes at the old doorway: once she recognizes her uncle as the man who paid for her schooling, the years of resentment give way to something the two of them can finally talk about.',
              zh: '“认知转折”落在旧屋门口：她一认出舅舅就是那个替她付学费的人，多年的怨气就松开了，两个人终于有话可说。',
            },
            hints: [
              { term: '最后一章', en: 'final chapter' },
              { term: '匿名资助', en: 'anonymous support' },
              { term: '舅舅', en: 'uncle' },
              { term: '旧屋门口', en: 'old doorway' },
              { term: '怨气', en: 'resentment' },
              { term: '多年', en: 'for years' },
            ],
          },
          {
            id: 'q-film-review',
            scenario:
              '影评初稿写道：“观众在最后一分钟迎来了全片的认知转折。”编辑在旁边画了个问号：认出来的到底是观众，还是那个终于看清自己错怪了谁的角色？',
            challenge: '改写这句话，把“观众被反转”和“人物认出真相”分开，并各用一个准确的英文说法。',
            focus:
              '分清 reveal/plot twist 与 anagnorisis 的施受关系：信息揭给观众，认知发生在人物身上；认出之后，人物还要重新处理那段关系。',
            reference: {
              en: 'The audience gets a reveal, not an anagnorisis: the character is the one who has to recognize whom he has been wrong about, and what that recognition asks of the two of them.',
              zh: '观众得到的是一次真相揭晓，而不是“认知转折”：必须认出自己一直错怪了谁的人，是那个角色；而这份认出会向他索要一个新的相处方式。',
            },
            hints: [
              { term: '影评初稿', en: 'draft review' },
              { term: '最后一分钟', en: 'final minute' },
              { term: '问号', en: 'question mark' },
              { term: '观众', en: 'audience' },
              { term: '角色', en: 'character' },
              { term: '错怪', en: 'wrongly blame' },
            ],
          },
        ],
      },
    },
  },
});
