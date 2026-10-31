package contracts

import "strings"

// DimensionKey names one of the three sequential analysis dimensions.
type DimensionKey string

const (
	KeyOne   DimensionKey = "one"
	KeyTwo   DimensionKey = "two"
	KeyThree DimensionKey = "three"
)

// DimensionOrder is the order in which the analyze endpoint produces the
// missing dimensions.
var DimensionOrder = []DimensionKey{KeyOne, KeyTwo, KeyThree}

// Config is the OpenAI-compatible provider configuration shared by every
// model-backed endpoint.
type Config struct {
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
	Model   string `json:"model"`
}

// Credentials is the subset accepted by model discovery.
type Credentials struct {
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
}

// Example is a paired English/Chinese example sentence.
type Example struct {
	EN string `json:"en"`
	ZH string `json:"zh"`
}

// Overview is the overview module of dimension one.
type Overview struct {
	Pronunciation string `json:"pronunciation"`
	Core          string `json:"core"`
	Definition    string `json:"definition"`
	PartOfSpeech  string `json:"partOfSpeech"`
}

// EvolutionStep is one stage in the origin story.
type EvolutionStep struct {
	ID         string  `json:"id"`
	Label      string  `json:"label"`
	Period     string  `json:"period"`
	Meaning    string  `json:"meaning"`
	Connection string  `json:"connection"`
	Example    Example `json:"example"`
}

// Origin is the origin module of dimension one.
type Origin struct {
	Story         string          `json:"story"`
	PhysicalImage string          `json:"physicalImage"`
	Evolution     []EvolutionStep `json:"evolution"`
}

// Cognate is one related word in the bloodline module.
type Cognate struct {
	Word       string `json:"word"`
	Meaning    string `json:"meaning"`
	Connection string `json:"connection"`
}

// Bloodline is the bloodline module of dimension one.
type Bloodline struct {
	Family     string    `json:"family"`
	Route      []string  `json:"route"`
	SocialFeel string    `json:"socialFeel"`
	Root       string    `json:"root"`
	Cognates   []Cognate `json:"cognates"`
}

// DimensionOne groups the overview, origin and bloodline modules.
type DimensionOne struct {
	Overview  Overview  `json:"overview"`
	Origin    Origin    `json:"origin"`
	Bloodline Bloodline `json:"bloodline"`
}

// Translation describes what a Chinese gloss adds and misses.
type Translation struct {
	Common string `json:"common"`
	Adds   string `json:"adds"`
	Misses string `json:"misses"`
}

// Concept is the concept module of dimension two.
type Concept struct {
	Scene       string      `json:"scene"`
	Trigger     string      `json:"trigger"`
	Psychology  string      `json:"psychology"`
	Intensity   string      `json:"intensity"`
	Boundary    string      `json:"boundary"`
	Translation Translation `json:"translation"`
}

// NuanceWord is one contrasted synonym.
type NuanceWord struct {
	Word        string  `json:"word"`
	Image       string  `json:"image"`
	Register    int     `json:"register"`
	Distinction string  `json:"distinction"`
	Example     Example `json:"example"`
}

// Nuance is the synonym comparison module of dimension two.
type Nuance struct {
	SharedScene string       `json:"sharedScene"`
	Words       []NuanceWord `json:"words"`
}

// DimensionTwo groups the concept and nuance modules.
type DimensionTwo struct {
	Concept Concept `json:"concept"`
	Nuance  Nuance  `json:"nuance"`
}

// Candidate is one register-level alternative.
type Candidate struct {
	Word    string  `json:"word"`
	Nuance  string  `json:"nuance"`
	Persona string  `json:"persona"`
	Prosody string  `json:"prosody"`
	Shift   string  `json:"shift"`
	Example Example `json:"example"`
}

// RegisterLevel is one step of the register thermometer.
type RegisterLevel struct {
	Level      int         `json:"level"`
	Label      string      `json:"label"`
	Candidates []Candidate `json:"candidates"`
}

// Register is the register module of dimension three.
type Register struct {
	Score              int             `json:"score"`
	Persona            string          `json:"persona"`
	Prosody            string          `json:"prosody"`
	ProsodyExplanation string          `json:"prosodyExplanation"`
	Subtext            string          `json:"subtext"`
	Levels             []RegisterLevel `json:"levels"`
}

// ChunkItem is one collocation.
type ChunkItem struct {
	Phrase  string  `json:"phrase"`
	Meaning string  `json:"meaning"`
	Example Example `json:"example"`
}

// CultureItem is one culture-bound expression.
type CultureItem struct {
	Expression  string  `json:"expression"`
	Explanation string  `json:"explanation"`
	Example     Example `json:"example"`
}

// Chunks is the chunks module of dimension three.
type Chunks struct {
	Items   []ChunkItem   `json:"items"`
	Culture []CultureItem `json:"culture"`
}

// Pitfall is one learner mistake.
type Pitfall struct {
	Wrong       string `json:"wrong"`
	Right       string `json:"right"`
	Explanation string `json:"explanation"`
	Image       string `json:"image"`
	Translation string `json:"translation"`
}

// Pitfalls is the pitfalls module of dimension three.
type Pitfalls struct {
	Items []Pitfall `json:"items"`
}

// DialogueLine is one dialogue turn.
type DialogueLine struct {
	Speaker    string `json:"speaker"`
	EN         string `json:"en"`
	ZH         string `json:"zh"`
	Annotation string `json:"annotation"`
}

// Dialogue is one practice dialogue.
type Dialogue struct {
	Setting string         `json:"setting"`
	Title   string         `json:"title"`
	Lines   []DialogueLine `json:"lines"`
}

// VocabularyHint is one contextual vocabulary annotation.
type VocabularyHint struct {
	Term string `json:"term"`
	EN   string `json:"en"`
}

// QuizQuestion is one output-style practice question.
type QuizQuestion struct {
	ID        string           `json:"id"`
	Scenario  string           `json:"scenario"`
	Challenge string           `json:"challenge"`
	Focus     string           `json:"focus"`
	Reference Example          `json:"reference"`
	Hints     []VocabularyHint `json:"hints,omitempty"`
}

// Slices is the practice module of dimension three.
type Slices struct {
	Dialogues []Dialogue     `json:"dialogues"`
	Quiz      []QuizQuestion `json:"quiz"`
}

// DimensionThree groups the register, chunks, pitfalls and slices modules.
type DimensionThree struct {
	Register Register `json:"register"`
	Chunks   Chunks   `json:"chunks"`
	Pitfalls Pitfalls `json:"pitfalls"`
	Slices   Slices   `json:"slices"`
}

// Dimensions holds the optional dimensions of a draft or analysis.
type Dimensions struct {
	One   *DimensionOne   `json:"one,omitempty"`
	Two   *DimensionTwo   `json:"two,omitempty"`
	Three *DimensionThree `json:"three,omitempty"`
}

// Draft is the versioned analysis draft sent to the analyze endpoint.
// Language names the target language and variety; Explain names the language
// its teaching copy is written in, and is empty in records saved before it
// existed.
type Draft struct {
	SchemaVersion int        `json:"schemaVersion"`
	ID            string     `json:"id"`
	CreatedAt     string     `json:"createdAt"`
	Target        string     `json:"target"`
	Language      string     `json:"language"`
	Explain       string     `json:"explain,omitempty"`
	Dimensions    Dimensions `json:"dimensions"`
}

// ExplainLanguage returns the stored explanation language, defaulting to the
// original Simplified Chinese for records that predate the field.
func (d Draft) ExplainLanguage() string {
	if value := strings.TrimSpace(d.Explain); value != "" {
		return value
	}
	return "简体中文"
}

// Scores are the three grade dimensions.
type Scores struct {
	Naturalness float64 `json:"naturalness"`
	Register    float64 `json:"register"`
	Imagery     float64 `json:"imagery"`
}

// Grade is the validated grading response.
type Grade struct {
	Scores     Scores   `json:"scores"`
	Feedback   string   `json:"feedback"`
	Correction Example  `json:"correction"`
	Changes    []string `json:"changes"`
	FollowUp   string   `json:"followUp"`
	UsesTarget bool     `json:"usesTarget"`
}

// StudyCard is one selected Anki export card.
type StudyCard struct {
	ID    string   `json:"id"`
	Type  string   `json:"type"`
	Front string   `json:"front"`
	Back  string   `json:"back"`
	Tags  []string `json:"tags"`
}
